"use strict";

const DATA_URL = "data/games/case-cosmos/challenges.json?v=case-cosmos-data-5";
const $ = (selector) => document.querySelector(selector);
const CZECH_CASES = Object.freeze([
  Object.freeze({ case: "Nominative", meaning: "naming or subject", question: "Who or what is the subject?" }),
  Object.freeze({ case: "Genitive", meaning: "belonging, origin, or absence", question: "Whose? From or without whom or what?" }),
  Object.freeze({ case: "Dative", meaning: "receiver or beneficiary", question: "Who or what receives or benefits?" }),
  Object.freeze({ case: "Accusative", meaning: "direct target", question: "Who or what is the target?" }),
  Object.freeze({ case: "Vocative", meaning: "direct address", question: "Who or what is addressed?" }),
  Object.freeze({ case: "Locative", meaning: "place or topic after a preposition", question: "Where, or about whom or what?" }),
  Object.freeze({ case: "Instrumental", meaning: "companion or means", question: "With whom, or using what?" })
]);
const LESSON = Object.freeze({
  title: "What role does the noun have?",
  instruction: "Match each case question and English situation to the Czech sentence for this noun.",
  idea: "One noun stays fixed while its Czech form changes through all seven cases. New noun patterns unlock with difficulty."
});

const state = {
  lesson: LESSON,
  pack: [],
  rounds: [],
  difficulty: 1,
  index: 0,
  phase: "loading",
  matched: new Set(),
  selectedSituation: -1,
  selectedSentence: -1,
  wrongSituation: -1,
  wrongSentence: -1,
  feedback: "",
  feedbackKind: "",
  locked: false,
  timer: 0,
  error: ""
};

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
  window.addEventListener("message", (event) => {
    if (event.origin !== window.location.origin || event.source !== window.parent) return;
    if (event.data?.source !== "caatuu-app-shell" || event.data.type !== "campaign-advance") return;
    nextRound();
  });
}

function requiredText(value, location, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${location} needs ${field}.`);
  }
}

function validatePack(value) {
  if (!Array.isArray(value) || value.length < 18) {
    throw new Error("challenges.json must contain a list of at least eighteen nouns.");
  }
  const expectedCases = CZECH_CASES.map((entry) => entry.case);
  const nouns = new Set();
  const difficulties = new Set();
  value.forEach((entry, nounIndex) => {
    const location = `Noun ${nounIndex + 1}`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`${location} must contain one noun and its cases.`);
    }
    const entryFields = Object.keys(entry);
    if (entryFields.length !== 3
        || entryFields[0] !== "noun"
        || entryFields[1] !== "difficulty"
        || entryFields[2] !== "cases") {
      throw new Error(`${location} may contain only noun, difficulty, and cases.`);
    }
    requiredText(entry.noun, location, "noun");
    if (nouns.has(entry.noun)) {
      throw new Error(`challenges.json repeats the noun ${entry.noun}.`);
    }
    nouns.add(entry.noun);
    if (!Number.isInteger(entry.difficulty) || entry.difficulty < 1 || entry.difficulty > 3) {
      throw new Error(`${entry.noun} needs a difficulty from 1 to 3.`);
    }
    difficulties.add(entry.difficulty);
    if (!entry.cases || typeof entry.cases !== "object" || Array.isArray(entry.cases)) {
      throw new Error(`${entry.noun} needs its seven cases.`);
    }
    const actualCases = Object.keys(entry.cases);
    if (actualCases.length !== expectedCases.length
        || expectedCases.some((caseName, index) => actualCases[index] !== caseName)) {
      throw new Error(`${entry.noun} must list the seven Czech cases in their standard order.`);
    }
    const sentences = new Set();
    CZECH_CASES.forEach(({ case: caseName }) => {
      const example = entry.cases[caseName];
      const caseLocation = `${entry.noun}, ${caseName}`;
      if (!example || typeof example !== "object" || Array.isArray(example)) {
        throw new Error(`${caseLocation} must contain one case example.`);
      }
      const fields = Object.keys(example);
      if (fields.length !== 3 || fields[0] !== "form" || fields[1] !== "english" || fields[2] !== "czech") {
        throw new Error(`${caseLocation} may contain only form, english, and czech.`);
      }
      requiredText(example.form, caseLocation, "form");
      requiredText(example.english, caseLocation, "english");
      requiredText(example.czech, caseLocation, "czech");
      if (!example.czech.toLocaleLowerCase("cs-CZ").includes(example.form.toLocaleLowerCase("cs-CZ"))) {
        throw new Error(`${caseLocation} must use its authored form in the Czech sentence.`);
      }
      if (sentences.has(example.czech)) {
        throw new Error(`${entry.noun} repeats the Czech sentence ${example.czech}.`);
      }
      sentences.add(example.czech);
    });
  });
  if (difficulties.size !== 3) {
    throw new Error("The noun bank must contain examples at difficulties 1, 2, and 3.");
  }
  return value;
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

function difficultyLabel(level) {
  return window.CaatuuLearning?.difficultyOption?.(level)?.label || `Level ${level}`;
}

function buildRounds(pack, difficulty) {
  return pack
    .filter((entry) => entry.difficulty <= difficulty)
    .sort((left, right) => left.difficulty - right.difficulty)
    .map((entry) => ({
    noun: entry.noun,
    difficulty: entry.difficulty,
    matches: CZECH_CASES.map((definition) => ({
      ...definition,
      ...entry.cases[definition.case]
    })),
    summary: {
      plain: `${entry.noun} is one noun. Its form changes as it moves through the seven cases.`,
      grammar: CZECH_CASES.map(({ case: caseName, question }) => `${caseName}: ${question}`).join(" ")
    }
  }));
}

function configureDifficulty() {
  state.difficulty = learningDifficulty();
  state.rounds = buildRounds(state.pack, state.difficulty);
  state.index = 0;
  state.phase = "matching";
  state.matched = new Set();
  state.selectedSituation = -1;
  state.selectedSentence = -1;
  state.wrongSituation = -1;
  state.wrongSentence = -1;
  state.locked = false;
}

function setFeedback(text, kind = "") {
  state.feedback = text;
  state.feedbackKind = kind;
}

function matchCountLabel(count) {
  return count === 7 ? "seven" : String(count);
}

function classNames(index, side) {
  const names = ["case-cosmos-option"];
  if (state.matched.has(index)) names.push("is-matched");
  if (side === "situation" && state.selectedSituation === index) names.push("is-selected");
  if (side === "sentence" && state.selectedSentence === index) names.push("is-selected");
  if (side === "situation" && state.wrongSituation === index) names.push("is-wrong");
  if (side === "sentence" && state.wrongSentence === index) names.push("is-wrong");
  return names.join(" ");
}

function createSituationOption(match, index) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = classNames(index, "situation");
  button.dataset.situationIndex = String(index);
  button.disabled = state.matched.has(index) || state.phase === "complete" || state.locked;
  button.setAttribute("aria-pressed", String(state.selectedSituation === index));

  const cue = document.createElement("strong");
  cue.textContent = match.question;
  const situation = document.createElement("span");
  situation.textContent = match.english;
  button.append(cue, situation);
  return button;
}

function createSentenceOption(match, index) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = classNames(index, "sentence");
  button.dataset.sentenceIndex = String(index);
  button.disabled = state.matched.has(index) || state.phase === "complete" || state.locked;
  button.setAttribute("aria-pressed", String(state.selectedSentence === index));
  button.lang = "cs-CZ";
  button.textContent = match.czech;
  return button;
}

function sentenceOrder(round) {
  return round.matches.map((match, displayIndex) => ({
    match,
    index: (displayIndex + 1) % round.matches.length
  })).map(({ index }) => ({ match: round.matches[index], index }));
}

function renderOptions(round) {
  const situations = round.matches.map((match, index) => createSituationOption(match, index));
  const sentences = sentenceOrder(round).map(({ match, index }) => createSentenceOption(match, index));
  $("#caseCosmosSituationOptions").replaceChildren(...situations);
  $("#caseCosmosSentenceOptions").replaceChildren(...sentences);
}

function renderPatterns(round) {
  const patterns = round.matches.map((match) => {
    const row = document.createElement("p");
    const caseLabel = document.createElement("span");
    caseLabel.textContent = `${match.case} — ${match.meaning}`;
    const form = document.createElement("strong");
    form.lang = "cs-CZ";
    form.textContent = match.form;
    row.append(caseLabel, form);
    return row;
  });
  $("#caseCosmosPatterns").replaceChildren(...patterns);
}

function renderRound() {
  const round = currentRound();
  if (!round) return;

  $("#caseCosmosPanel").setAttribute("aria-busy", "false");
  $("#caseCosmosRouteNumber").textContent = String(state.index + 1);
  $("#caseCosmosRoundTitle").textContent = `Round ${state.index + 1} · Noun: ${round.noun} · Level ${round.difficulty}`;
  $("#caseCosmosTitle").textContent = state.lesson.title;
  $("#caseCosmosInstruction").textContent = state.lesson.instruction;
  $("#caseCosmosIdea").textContent = state.lesson.idea;
  $("#caseCosmosProgress").textContent = `Round ${state.index + 1} of ${state.rounds.length} · ${difficultyLabel(state.difficulty)}`;
  renderOptions(round);

  const complete = state.phase === "complete";
  $("#caseCosmosResult").hidden = !complete;
  if (complete) {
    $("#caseCosmosResultKicker").textContent = `All ${matchCountLabel(round.matches.length)} matched`;
    $("#caseCosmosResultTitle").textContent = `Seven forms of ${round.noun}`;
    renderPatterns(round);
    $("#caseCosmosPlainSummary").textContent = round.summary.plain;
    $("#caseCosmosGrammarSummary").textContent = round.summary.grammar;
  }

  const feedback = $("#caseCosmosFeedback");
  feedback.textContent = state.feedback;
  feedback.className = `case-cosmos-feedback${state.feedbackKind ? ` is-${state.feedbackKind}` : ""}`;

  const next = $("#caseCosmosNext");
  next.hidden = !complete;
  next.textContent = state.rounds.length === 1
    ? "Restart board"
    : state.index === state.rounds.length - 1 ? "Restart lesson" : "Next noun";
}

function render() {
  const loading = state.phase === "loading";
  const error = state.phase === "error";
  $("#caseCosmosLoading").hidden = !loading;
  $("#caseCosmosBoard").hidden = loading || error;
  $("#caseCosmosFooter").hidden = loading || error;
  $("#caseCosmosError").hidden = !error;
  if (error) {
    $("#caseCosmosPanel").setAttribute("aria-busy", "false");
    $("#caseCosmosErrorCopy").textContent = state.error;
    return;
  }
  if (!loading) renderRound();
}

function clearWrongMatch() {
  window.clearTimeout(state.timer);
  state.timer = window.setTimeout(() => {
    state.selectedSituation = -1;
    state.selectedSentence = -1;
    state.wrongSituation = -1;
    state.wrongSentence = -1;
    state.locked = false;
    setFeedback("Try again: choose cards that mean the same thing.");
    render();
    $("#caseCosmosSituationOptions button:not(:disabled)")?.focus();
  }, 850);
}

function settleMatch() {
  if (state.selectedSituation < 0 || state.selectedSentence < 0) return;
  const round = currentRound();
  const correct = state.selectedSituation === state.selectedSentence;
  record({ activities: 1, attempts: 1, successes: correct ? 1 : 0, xp: correct ? 1 : 0 });

  if (!correct) {
    state.wrongSituation = state.selectedSituation;
    state.wrongSentence = state.selectedSentence;
    state.locked = true;
    setFeedback("Those two cards have different meanings. Compare the English and Czech situations.", "wrong");
    render();
    clearWrongMatch();
    return;
  }

  const matchedIndex = state.selectedSituation;
  state.matched.add(matchedIndex);
  state.selectedSituation = -1;
  state.selectedSentence = -1;
  const matched = round.matches[matchedIndex];
  setFeedback(`Matched ${matched.case}: ${matched.meaning}.`, "correct");

  if (state.matched.size === round.matches.length) {
    state.phase = "complete";
    setFeedback(`All ${matchCountLabel(round.matches.length)} meanings matched. Now compare the seven forms of ${round.noun}.`, "correct");
    record({ rounds: 1, xp: 1 });
    announceRoundSuccess();
  }
  render();
  if (state.phase === "complete") $("#caseCosmosNext")?.focus();
}

function chooseSituation(index) {
  if (state.phase !== "matching" || state.locked || state.matched.has(index)) return;
  state.selectedSituation = index;
  setFeedback("Now choose the Czech sentence that means the same thing.");
  render();
  settleMatch();
}

function chooseSentence(index) {
  if (state.phase !== "matching" || state.locked || state.matched.has(index)) return;
  state.selectedSentence = index;
  setFeedback("Now choose the everyday situation with the same meaning.");
  render();
  settleMatch();
}

function nextRound() {
  if (state.phase !== "complete") return;
  window.clearTimeout(state.timer);
  $(".case-cosmos-grammar").open = false;
  state.index = (state.index + 1) % state.rounds.length;
  state.phase = "matching";
  state.matched = new Set();
  state.selectedSituation = -1;
  state.selectedSentence = -1;
  state.wrongSituation = -1;
  state.wrongSentence = -1;
  state.locked = false;
  setFeedback("Pick one situation, then match it to a Czech sentence.");
  render();
  $("#caseCosmosSituationOptions button")?.focus();
}

function bindUi() {
  bindCampaignBridge();
  $("#caseCosmosPanel").addEventListener("click", (event) => {
    const situation = event.target.closest("button[data-situation-index]");
    if (situation) {
      chooseSituation(Number(situation.dataset.situationIndex));
      return;
    }
    const sentence = event.target.closest("button[data-sentence-index]");
    if (sentence) chooseSentence(Number(sentence.dataset.sentenceIndex));
  });
  $("#caseCosmosNext").addEventListener("click", nextRound);
  window.addEventListener("caatuu:learning-change", (event) => {
    if (event.detail?.reason !== "difficulty" || !state.pack.length) return;
    window.clearTimeout(state.timer);
    configureDifficulty();
    setFeedback(`Showing ${difficultyLabel(state.difficulty)} nouns.`);
    render();
    $("#caseCosmosSituationOptions button")?.focus();
  });
}

function showError(error) {
  console.error("Case Cosmos failed", error);
  state.error = error?.message || String(error);
  state.phase = "error";
  render();
}

async function init() {
  bindUi();
  render();
  try {
    const pack = await loadPack();
    state.pack = pack;
    configureDifficulty();
    setFeedback("Pick one situation, then match it to a Czech sentence.");
    render();
    window.CaatuuRuntime?.registerServiceWorker?.().catch(() => {});
  } catch (error) {
    showError(error);
  }
}

init();
