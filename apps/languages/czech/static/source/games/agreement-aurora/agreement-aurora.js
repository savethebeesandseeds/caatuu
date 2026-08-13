"use strict";

const DATA_URL = "data/games/agreement-aurora/challenges.json?v=agreement-aurora-data-2";
const $ = (selector) => document.querySelector(selector);
const GENDERS = Object.freeze([
  Object.freeze({ key: "masculine", label: "Masculine noun" }),
  Object.freeze({ key: "feminine", label: "Feminine noun" }),
  Object.freeze({ key: "neuter", label: "Neuter noun" })
]);
const LESSON = Object.freeze({
  title: "Make the adjective match",
  instruction: "Match each English phrase to the complete Czech phrase.",
  idea: "The noun stays in its ordinary naming form. The adjective changes to match the noun's gender."
});

const state = {
  pack: [],
  rounds: [],
  difficulty: 1,
  index: 0,
  phase: "loading",
  matched: new Set(),
  selectedEnglish: -1,
  selectedCzech: -1,
  wrongEnglish: -1,
  wrongCzech: -1,
  feedback: "",
  feedbackKind: "",
  locked: false,
  timer: 0,
  error: ""
};

function record(delta) {
  window.CaatuuLearning?.record?.("agreement-aurora", delta);
}

function requiredText(value, location, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${location} needs ${field}.`);
  }
}

function validatePack(value) {
  if (!Array.isArray(value) || value.length < 8) {
    throw new Error("challenges.json must contain a list of at least eight adjectives.");
  }

  const adjectives = new Set();
  const difficulties = new Set();
  const expectedGenders = GENDERS.map(({ key }) => key);

  value.forEach((entry, adjectiveIndex) => {
    const location = `Adjective ${adjectiveIndex + 1}`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`${location} must contain one adjective and its forms.`);
    }
    const fields = Object.keys(entry);
    if (fields.length !== 3
        || fields[0] !== "adjective"
        || fields[1] !== "difficulty"
        || fields[2] !== "forms") {
      throw new Error(`${location} may contain only adjective, difficulty, and forms.`);
    }

    requiredText(entry.adjective, location, "adjective");
    if (adjectives.has(entry.adjective)) {
      throw new Error(`challenges.json repeats the adjective ${entry.adjective}.`);
    }
    adjectives.add(entry.adjective);

    if (!Number.isInteger(entry.difficulty) || entry.difficulty < 1 || entry.difficulty > 3) {
      throw new Error(`${entry.adjective} needs a difficulty from 1 to 3.`);
    }
    difficulties.add(entry.difficulty);

    if (!entry.forms || typeof entry.forms !== "object" || Array.isArray(entry.forms)) {
      throw new Error(`${entry.adjective} needs masculine, feminine, and neuter forms.`);
    }
    const actualGenders = Object.keys(entry.forms);
    if (actualGenders.length !== expectedGenders.length
        || expectedGenders.some((gender, index) => actualGenders[index] !== gender)) {
      throw new Error(`${entry.adjective} must list masculine, feminine, and neuter in that order.`);
    }

    const authoredForms = new Set();
    const englishPhrases = new Set();
    const czechPhrases = new Set();
    GENDERS.forEach(({ key, label }) => {
      const form = entry.forms[key];
      const formLocation = `${entry.adjective}, ${label}`;
      if (!form || typeof form !== "object" || Array.isArray(form)) {
        throw new Error(`${formLocation} must contain one form and its examples.`);
      }
      const formFields = Object.keys(form);
      if (formFields.length !== 2
          || formFields[0] !== "form"
          || formFields[1] !== "examples") {
        throw new Error(`${formLocation} may contain only form and examples.`);
      }
      requiredText(form.form, formLocation, "form");
      if (authoredForms.has(form.form)) {
        throw new Error(`${entry.adjective} must visibly contrast all three adjective forms.`);
      }
      authoredForms.add(form.form);

      if (!Array.isArray(form.examples) || form.examples.length < 3) {
        throw new Error(`${formLocation} needs at least three examples.`);
      }
      form.examples.forEach((example, exampleIndex) => {
        const exampleLocation = `${formLocation}, example ${exampleIndex + 1}`;
        if (!example || typeof example !== "object" || Array.isArray(example)) {
          throw new Error(`${exampleLocation} must contain one English/Czech phrase pair.`);
        }
        const exampleFields = Object.keys(example);
        if (exampleFields.length !== 2
            || exampleFields[0] !== "english"
            || exampleFields[1] !== "czech") {
          throw new Error(`${exampleLocation} may contain only english and czech.`);
        }
        requiredText(example.english, exampleLocation, "english");
        requiredText(example.czech, exampleLocation, "czech");

        const normalizedForm = form.form.toLocaleLowerCase("cs-CZ");
        const normalizedPhrase = example.czech.toLocaleLowerCase("cs-CZ");
        if (!normalizedPhrase.startsWith(`${normalizedForm} `)) {
          throw new Error(`${exampleLocation} must begin with the authored adjective form.`);
        }
        if (englishPhrases.has(example.english) || czechPhrases.has(example.czech)) {
          throw new Error(`${entry.adjective} must use distinct phrase pairs within each language.`);
        }
        englishPhrases.add(example.english);
        czechPhrases.add(example.czech);
      });
    });

    if (entry.forms.masculine.form !== entry.adjective) {
      throw new Error(`${entry.adjective} must use its masculine form as the adjective heading.`);
    }
  });

  if (difficulties.size !== 3) {
    throw new Error("The adjective bank must contain examples at difficulties 1, 2, and 3.");
  }
  return value;
}

async function loadPack() {
  const response = await fetch(DATA_URL, { cache: "reload" });
  if (!response.ok) throw new Error(`Could not load challenges.json (${response.status}).`);
  return validatePack(await response.json());
}

function learningDifficulty() {
  const value = Number(window.CaatuuLearning?.difficulty?.() || 1);
  return Number.isInteger(value) && value >= 1 && value <= 3 ? value : 1;
}

function difficultyLabel(level) {
  return window.CaatuuLearning?.difficultyOption?.(level)?.label || `Level ${level}`;
}

function chooseExample(form) {
  const example = form.examples[Math.floor(Math.random() * form.examples.length)];
  return { form: form.form, ...example };
}

function buildRounds(pack, difficulty) {
  return pack
    .filter((entry) => entry.difficulty <= difficulty)
    .sort((left, right) => left.difficulty - right.difficulty)
    .map((entry) => ({
      adjective: entry.adjective,
      difficulty: entry.difficulty,
      matches: GENDERS.map((gender) => ({
        ...gender,
        ...chooseExample(entry.forms[gender.key])
      }))
    }));
}

function currentRound() {
  return state.rounds[state.index] || null;
}

function resetRound() {
  state.phase = "matching";
  state.matched = new Set();
  state.selectedEnglish = -1;
  state.selectedCzech = -1;
  state.wrongEnglish = -1;
  state.wrongCzech = -1;
  state.locked = false;
}

function configureDifficulty() {
  state.difficulty = learningDifficulty();
  state.rounds = buildRounds(state.pack, state.difficulty);
  state.index = 0;
  resetRound();
}

function setFeedback(text, kind = "") {
  state.feedback = text;
  state.feedbackKind = kind;
}

function optionClasses(index, side) {
  const names = ["agreement-aurora-option"];
  if (state.matched.has(index)) names.push("is-matched");
  if (side === "english" && state.selectedEnglish === index) names.push("is-selected");
  if (side === "czech" && state.selectedCzech === index) names.push("is-selected");
  if (side === "english" && state.wrongEnglish === index) names.push("is-wrong");
  if (side === "czech" && state.wrongCzech === index) names.push("is-wrong");
  return names.join(" ");
}

function createEnglishOption(match, index) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = optionClasses(index, "english");
  button.dataset.englishIndex = String(index);
  button.disabled = state.matched.has(index) || state.phase === "complete" || state.locked;
  button.setAttribute("aria-pressed", String(state.selectedEnglish === index));

  const gender = document.createElement("strong");
  gender.textContent = match.label;
  const phrase = document.createElement("span");
  phrase.textContent = match.english;
  button.append(gender, phrase);
  return button;
}

function createCzechOption(match, index) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = optionClasses(index, "czech");
  button.dataset.czechIndex = String(index);
  button.disabled = state.matched.has(index) || state.phase === "complete" || state.locked;
  button.setAttribute("aria-pressed", String(state.selectedCzech === index));
  button.lang = "cs-CZ";
  button.textContent = match.czech;
  return button;
}

function czechOrder(round) {
  return round.matches.map((match, displayIndex) => {
    const index = (displayIndex + 1) % round.matches.length;
    return { match: round.matches[index], index };
  });
}

function renderOptions(round) {
  const english = round.matches.map((match, index) => createEnglishOption(match, index));
  const czech = czechOrder(round).map(({ match, index }) => createCzechOption(match, index));
  $("#agreementAuroraEnglishOptions").replaceChildren(...english);
  $("#agreementAuroraCzechOptions").replaceChildren(...czech);
}

function renderPatterns(round) {
  const patterns = round.matches.map((match) => {
    const row = document.createElement("p");
    const label = document.createElement("span");
    label.textContent = match.label;
    const form = document.createElement("strong");
    form.lang = "cs-CZ";
    form.textContent = match.form;
    row.append(label, form);
    return row;
  });
  $("#agreementAuroraPatterns").replaceChildren(...patterns);
}

function renderRound() {
  const round = currentRound();
  if (!round) return;

  $("#agreementAuroraPanel").setAttribute("aria-busy", "false");
  $("#agreementAuroraRouteNumber").textContent = String(state.index + 1);
  $("#agreementAuroraRoundTitle").textContent = `Round ${state.index + 1} · Adjective: ${round.adjective} · Level ${round.difficulty}`;
  $("#agreementAuroraTitle").textContent = LESSON.title;
  $("#agreementAuroraInstruction").textContent = LESSON.instruction;
  $("#agreementAuroraIdea").textContent = LESSON.idea;
  $("#agreementAuroraProgress").textContent = `Round ${state.index + 1} of ${state.rounds.length} · ${difficultyLabel(state.difficulty)}`;
  renderOptions(round);

  const complete = state.phase === "complete";
  $("#agreementAuroraResult").hidden = !complete;
  if (complete) {
    $("#agreementAuroraResultTitle").textContent = `Three forms of ${round.adjective}`;
    renderPatterns(round);
    $("#agreementAuroraSummary").textContent = `${round.adjective} changes to match a masculine, feminine, or neuter noun.`;
  }

  const feedback = $("#agreementAuroraFeedback");
  feedback.textContent = state.feedback;
  feedback.className = `agreement-aurora-feedback${state.feedbackKind ? ` is-${state.feedbackKind}` : ""}`;

  const next = $("#agreementAuroraNext");
  next.hidden = !complete;
  next.textContent = state.rounds.length === 1
    ? "Restart board"
    : state.index === state.rounds.length - 1 ? "Restart lesson" : "Next adjective";
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
  window.clearTimeout(state.timer);
  state.timer = window.setTimeout(() => {
    state.selectedEnglish = -1;
    state.selectedCzech = -1;
    state.wrongEnglish = -1;
    state.wrongCzech = -1;
    state.locked = false;
    setFeedback("Try again: choose phrases that mean the same thing.");
    render();
    $("#agreementAuroraEnglishOptions button:not(:disabled)")?.focus();
  }, 850);
}

function settleMatch() {
  if (state.selectedEnglish < 0 || state.selectedCzech < 0) return;
  const round = currentRound();
  const correct = state.selectedEnglish === state.selectedCzech;
  record({ activities: 1, attempts: 1, successes: correct ? 1 : 0, xp: correct ? 1 : 0 });

  if (!correct) {
    state.wrongEnglish = state.selectedEnglish;
    state.wrongCzech = state.selectedCzech;
    state.locked = true;
    setFeedback("Those phrases have different meanings. Compare the noun in each phrase.", "wrong");
    render();
    clearWrongMatch();
    return;
  }

  const matchedIndex = state.selectedEnglish;
  const matched = round.matches[matchedIndex];
  state.matched.add(matchedIndex);
  state.selectedEnglish = -1;
  state.selectedCzech = -1;
  setFeedback(`Matched ${matched.label.toLowerCase()}: ${matched.form}.`, "correct");

  if (state.matched.size === round.matches.length) {
    state.phase = "complete";
    setFeedback(`All three phrases matched. Compare the three forms of ${round.adjective}.`, "correct");
    record({ rounds: 1, xp: 1 });
  }
  render();
  if (state.phase === "complete") $("#agreementAuroraNext")?.focus();
}

function chooseEnglish(index) {
  if (state.phase !== "matching" || state.locked || state.matched.has(index)) return;
  state.selectedEnglish = index;
  setFeedback("Now choose the Czech phrase with the same meaning.");
  render();
  settleMatch();
}

function chooseCzech(index) {
  if (state.phase !== "matching" || state.locked || state.matched.has(index)) return;
  state.selectedCzech = index;
  setFeedback("Now choose the English phrase with the same meaning.");
  render();
  settleMatch();
}

function nextRound() {
  if (state.phase !== "complete") return;
  window.clearTimeout(state.timer);
  if (state.index === state.rounds.length - 1) {
    state.rounds = buildRounds(state.pack, state.difficulty);
    state.index = 0;
  } else {
    state.index += 1;
  }
  resetRound();
  setFeedback("Pick one English phrase, then match it to a Czech phrase.");
  render();
  $("#agreementAuroraEnglishOptions button")?.focus();
}

function bindUi() {
  $("#agreementAuroraPanel").addEventListener("click", (event) => {
    const english = event.target.closest("button[data-english-index]");
    if (english) {
      chooseEnglish(Number(english.dataset.englishIndex));
      return;
    }
    const czech = event.target.closest("button[data-czech-index]");
    if (czech) chooseCzech(Number(czech.dataset.czechIndex));
  });
  $("#agreementAuroraNext").addEventListener("click", nextRound);
  window.addEventListener("caatuu:learning-change", (event) => {
    if (event.detail?.reason !== "difficulty" || !state.pack.length) return;
    window.clearTimeout(state.timer);
    configureDifficulty();
    setFeedback(`Showing ${difficultyLabel(state.difficulty)} adjectives.`);
    render();
    $("#agreementAuroraEnglishOptions button")?.focus();
  });
}

function showError(error) {
  console.error("Agreement Aurora failed", error);
  state.error = error?.message || String(error);
  state.phase = "error";
  render();
}

async function init() {
  bindUi();
  render();
  try {
    state.pack = await loadPack();
    configureDifficulty();
    setFeedback("Pick one English phrase, then match it to a Czech phrase.");
    render();
    window.CaatuuRuntime?.registerServiceWorker?.().catch(() => {});
  } catch (error) {
    showError(error);
  }
}

init();
