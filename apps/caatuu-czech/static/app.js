let countryDictionary = [];
let countryScripts = [];
let deferredPwaInstallPrompt = null;

async function loadJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Could not load ${path}: ${response.status}`);
  return response.json();
}

function assertArrayData(name, value) {
  if (!Array.isArray(value)) throw new Error(`Expected ${name} to be an array.`);
}

async function loadContentData() {
  const [dictionary, scripts, verbs] = await Promise.all([
    loadJson("data/dictionary.json"),
    loadJson("data/scripts.json"),
    loadJson("data/verbs.json")
  ]);

  assertArrayData("dictionary", dictionary);
  assertArrayData("scripts", scripts);
  assertArrayData("verbs", verbs);
  countryDictionary = dictionary;
  countryScripts = scripts;
  fundamentalVerbs = verbs;
}

const state = {
  activeView: "guide",
  verbOptionsOpen: false,
  verbQuestion: null,
  verbStats: {
    asked: 0,
    correct: 0,
    streak: 0,
    bestStreak: 0
  },
  verbMastery: {},
  verbMemoryLoaded: false,
  verbRecentKeys: [],
  verbSession: {
    answered: false,
    attempts: 0,
    selectedAnswer: "",
    result: null
  },
  verbReferenceSearch: "",
  dictionarySearch: "",
  verbFocusFallback: false
};

const $ = (selector) => document.querySelector(selector);

function isPwaInstalled() {
  return window.matchMedia?.("(display-mode: standalone)")?.matches || window.navigator.standalone === true;
}

function updatePwaInstallUi(statusText = "") {
  const button = $("#installPwaAction");
  const status = $("#pwaInstallStatus");
  if (!button || !status) return;

  if (isPwaInstalled()) {
    button.textContent = "Installed";
    button.disabled = true;
    status.textContent = "Offline ready";
    return;
  }

  button.textContent = "Install app";
  button.disabled = !deferredPwaInstallPrompt;
  status.textContent = statusText || (deferredPwaInstallPrompt ? "Installable" : "Browser menu");
}

async function promptPwaInstall() {
  if (!deferredPwaInstallPrompt) {
    updatePwaInstallUi("Browser menu");
    return;
  }

  const promptEvent = deferredPwaInstallPrompt;
  deferredPwaInstallPrompt = null;
  promptEvent.prompt();

  try {
    const choice = await promptEvent.userChoice;
    updatePwaInstallUi(choice?.outcome === "accepted" ? "Installed" : "Browser menu");
  } catch (error) {
    updatePwaInstallUi("Browser menu");
  }
}

function bindPwaInstall() {
  updatePwaInstallUi();
  $("#installPwaAction")?.addEventListener("click", promptPwaInstall);

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPwaInstallPrompt = event;
    updatePwaInstallUi("Installable");
  });

  window.addEventListener("appinstalled", () => {
    deferredPwaInstallPrompt = null;
    updatePwaInstallUi("Offline ready");
  });

  window.matchMedia?.("(display-mode: standalone)")?.addEventListener?.("change", () => {
    updatePwaInstallUi();
  });
}

const verbStorageKey = "caatuu-czech.verb-memory.v2";
const verbRecentLimit = 8;
const verbAccentChars = ["á", "č", "ď", "é", "ě", "í", "ň", "ó", "ř", "š", "ť", "ú", "ů", "ý", "ž"];

const verbPersonData = [
  { key: "1s", label: "já", english: "I", pronouns: ["já"], short: "1sg" },
  { key: "2s", label: "ty", english: "you", pronouns: ["ty"], short: "2sg" },
  { key: "3s", label: "on/ona", english: "he/she/it", pronouns: ["on", "ona", "ono"], short: "3sg" },
  { key: "1p", label: "my", english: "we", pronouns: ["my"], short: "1pl" },
  { key: "2p", label: "vy", english: "you all", pronouns: ["vy"], short: "2pl" },
  { key: "3p", label: "oni", english: "they", pronouns: ["oni", "ony"], short: "3pl" }
];

const verbPersonMap = Object.fromEntries(verbPersonData.map((person) => [person.key, person]));

const verbFamilyLabels = {
  core: "Core",
  modal: "Modal",
  motion: "Motion",
  daily: "Daily",
  senses: "Senses",
  talk: "Talk",
  social: "Social"
};

const verbFamilyOrder = ["core", "modal", "motion", "daily", "senses", "talk", "social"];

const verbCommonLevelLabels = {
  1: "Level 1 · most common",
  2: "Level 2 · common",
  3: "Level 3 · situational"
};

const verbCommonLevelDescriptions = {
  1: "Survival verbs you see everywhere.",
  2: "Everyday verbs after the first layer is warm.",
  3: "Useful, but more specific or nuanced."
};

const verbCommonLevelOrder = [1, 2, 3];

let fundamentalVerbs = [];

const defaultPrintOptions = {
  orientation: "landscape",
  columns: "4",
  rows: "2",
  gap: "6",
  joinMargin: "8",
  textScale: "1.12",
  fillBlankRows: true,
  includeGuide: true,
  includeDictionary: true,
  includeScripts: true,
  sides: "booklet"
};

const paperPresets = {
  a4: { label: "A4", css: "A4", width: 210, height: 297 },
  letter: { label: "Letter", css: "letter", width: 216, height: 279 }
};

function textUnits(value) {
  return [...String(value)].reduce((total, char) => {
    if (char === " " || char === "/" || char === "-") return total + 0.45;
    if ("mwMW".includes(char)) return total + 1.25;
    if (char >= "A" && char <= "Z") return total + 1.12;
    return total + 1;
  }, 0);
}

function estimatedLines(value, limit) {
  return Math.max(1, Math.ceil(textUnits(value) / limit));
}

function scalePt(value, scale = 1) {
  const size = Number.parseFloat(value);
  if (!Number.isFinite(size)) return value;
  return `${(size * scale).toFixed(2)}pt`;
}

function printLayout(options) {
  const pageSlots = options.columns * options.rows;
  const compact = Math.max(options.columns, options.rows);
  const dense = pageSlots >= 12 || compact >= 4;

  if (pageSlots <= 4) {
    return {
      cols: options.columns,
      rows: options.rows,
      pageSlots,
      margin: "6mm",
      gap: `${options.gap}mm`,
      wordFont: "6.4pt",
      smallFont: "5.1pt",
      translationFont: "6.8pt",
      codeFont: "4.8pt",
      headFont: "6.2pt",
      titleFont: "12pt",
      blankHeight: "18px",
      blankLine: "15px"
    };
  }

  if (pageSlots <= 8 && !dense) {
    return {
      cols: options.columns,
      rows: options.rows,
      pageSlots,
      margin: "5mm",
      gap: `${options.gap}mm`,
      wordFont: "5.6pt",
      smallFont: "4.6pt",
      translationFont: "6pt",
      codeFont: "4.3pt",
      headFont: "5.5pt",
      titleFont: "10.5pt",
      blankHeight: "15px",
      blankLine: "12px"
    };
  }

  if (pageSlots <= 8) {
    return {
      cols: options.columns,
      rows: options.rows,
      pageSlots,
      margin: "5mm",
      gap: `${options.gap}mm`,
      wordFont: "5.2pt",
      smallFont: "4.3pt",
      translationFont: "6pt",
      codeFont: "4pt",
      headFont: "5.2pt",
      titleFont: "10pt",
      blankHeight: "14px",
      blankLine: "12px"
    };
  }

  if (pageSlots <= 12) {
    return {
      cols: options.columns,
      rows: options.rows,
      pageSlots,
      margin: "4.5mm",
      gap: `${options.gap}mm`,
      wordFont: "4.6pt",
      smallFont: "3.9pt",
      translationFont: "5pt",
      codeFont: "3.6pt",
      headFont: "4.6pt",
      titleFont: "9pt",
      blankHeight: "12px",
      blankLine: "10px"
    };
  }

  return {
    cols: options.columns,
    rows: options.rows,
    pageSlots,
    margin: "4mm",
    gap: `${options.gap}mm`,
    wordFont: "4.1pt",
    smallFont: "3.5pt",
    translationFont: "4.5pt",
    codeFont: "3.3pt",
    headFont: "4.1pt",
    titleFont: "8pt",
    blankHeight: "10px",
    blankLine: "9px"
  };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function categories() {
  return [...new Set(countryDictionary.map((item) => item.cat))];
}

function normalizeDictionarySearch(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

function dictionarySearchText(item) {
  return normalizeDictionarySearch([
    item.cs,
    item.en,
    item.kind,
    item.use,
    item.cue,
    item.cat
  ].join(" "));
}

function nounModels() {
  return [
    ...new Set(
      countryDictionary
        .map((item) => item.kind.match(/^N\s+[^>]+>[\p{L}-]+/u)?.[0])
        .filter(Boolean)
    )
  ];
}

function renderDictionary() {
  const query = normalizeDictionarySearch(state.dictionarySearch);
  const filtered = query
    ? countryDictionary.filter((item) => dictionarySearchText(item).includes(query))
    : countryDictionary;
  const groupData = categories()
    .map((category) => ({
      category,
      rows: filtered.filter((item) => item.cat === category)
    }))
    .filter((group) => group.rows.length);
  const count = $("#dictionaryCount");
  if (count) {
    count.textContent = `${filtered.length}/${countryDictionary.length} entries`;
  }

  if (!filtered.length) {
    $("#dictionaryList").innerHTML = `<p class="empty-state">No rows found. Try a simpler word, without endings or diacritics.</p>`;
  } else {
    $("#dictionaryList").replaceChildren(
      ...groupData.map((group) => {
        const section = document.createElement("section");
        section.className = "dictionary-group";
        section.innerHTML = `
          <h4><span>${escapeHtml(group.category)}</span><small>${group.rows.length}</small></h4>
          <div class="dictionary-rows">
          ${group.rows.map((item) => `
            <article class="dictionary-entry">
              <div class="dict-line dict-word">
                <b>${escapeHtml(item.cs)}</b>
                <span>${escapeHtml(item.en)}</span>
                <small>${escapeHtml(item.kind)}</small>
              </div>
              <div class="dict-line dict-example">
                <em>${escapeHtml(item.use)}</em>
                <code>${escapeHtml(item.cue)}</code>
              </div>
            </article>
          `).join("")}
          </div>
        `;
        return section;
      })
    );
  }

  $("#scriptCount").textContent = `${countryScripts.length} scripts`;
  $("#scriptList").replaceChildren(
    ...countryScripts.map((script) => {
      const card = document.createElement("article");
      card.className = "script-card";
      card.innerHTML = `
        <h4><span>${escapeHtml(script.title)}</span><small>${escapeHtml(script.goal)}</small></h4>
        <div class="script-rows">
          ${script.lines.map((line) => `
            <div class="script-row">
              <b>${escapeHtml(line.cs)}</b>
              <span>${escapeHtml(line.en)}</span>
            </div>
          `).join("")}
        </div>
      `;
      return card;
    })
  );
}

function checkedValues(selector) {
  return [...document.querySelectorAll(selector)]
    .filter((input) => input.checked)
    .map((input) => input.value);
}

function loadVerbMemory() {
  try {
    const raw = localStorage.getItem(verbStorageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    console.warn("Could not read verb memory", error);
    return {};
  }
}

function saveVerbMemory() {
  try {
    localStorage.setItem(verbStorageKey, JSON.stringify(state.verbMastery));
  } catch (error) {
    console.warn("Could not save verb memory", error);
  }
}

function ensureVerbMemory() {
  if (state.verbMemoryLoaded) return;
  state.verbMastery = loadVerbMemory();
  state.verbMemoryLoaded = true;
}

function verbFamiliesInData() {
  const seen = new Set(fundamentalVerbs.map((verb) => verb.family).filter(Boolean));
  return [...seen].sort((left, right) => {
    const leftIndex = verbFamilyOrder.indexOf(left);
    const rightIndex = verbFamilyOrder.indexOf(right);
    if (leftIndex === -1 && rightIndex === -1) return left.localeCompare(right);
    if (leftIndex === -1) return 1;
    if (rightIndex === -1) return -1;
    return leftIndex - rightIndex;
  });
}

function verbFamilyLabel(key) {
  return verbFamilyLabels[key] || key.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function verbCommonLevel(verb) {
  const level = Number(verb?.commonLevel ?? 2);
  return verbCommonLevelOrder.includes(level) ? level : 2;
}

function verbCommonLevelLabel(level) {
  return verbCommonLevelLabels[level] || `Level ${level}`;
}

function verbCommonLevelShortLabel(level) {
  return `L${level} common`;
}

function selectedVerbCommonLevels() {
  const inputs = [...document.querySelectorAll('input[name="verbCommonLevel"]')];
  if (!inputs.length) return [...verbCommonLevelOrder];
  return inputs
    .filter((input) => input.checked)
    .map((input) => Number(input.value))
    .filter((level) => verbCommonLevelOrder.includes(level));
}

function commonLevelSelectionLabel(levels) {
  const selected = [...new Set(levels)].sort((left, right) => left - right);
  if (!selected.length) return "no commonness levels";
  if (selected.length === verbCommonLevelOrder.length) return "Levels 1–3";
  return selected.map((level) => `L${level}`).join(", ");
}

function renderVerbCommonLevelOptions() {
  const host = $("#verbCommonLevelOptions");
  if (!host) return;
  const existing = selectedVerbCommonLevels();
  const selected = existing.length ? new Set(existing.map(String)) : new Set(verbCommonLevelOrder.map(String));
  const snapshot = verbCommonLevelOrder.join("|");
  if (host.dataset.snapshot === snapshot) return;

  host.dataset.snapshot = snapshot;
  host.replaceChildren(
    ...verbCommonLevelOrder.map((level) => {
      const label = document.createElement("label");
      label.title = verbCommonLevelDescriptions[level] || "";
      label.innerHTML = `
        <input type="checkbox" name="verbCommonLevel" value="${level}" ${selected.has(String(level)) ? "checked" : ""}>
        <span><b>${escapeHtml(verbCommonLevelLabel(level))}</b><small>${escapeHtml(verbCommonLevelDescriptions[level] || "")}</small></span>
      `;
      return label;
    })
  );
}

function renderVerbFamilyOptions() {
  const host = $("#verbFamilyOptions");
  if (!host) return;
  const families = verbFamiliesInData();
  const snapshot = families.join("|");
  if (host.dataset.snapshot === snapshot) return;

  host.dataset.snapshot = snapshot;
  host.replaceChildren(
    ...families.map((family) => {
      const label = document.createElement("label");
      label.innerHTML = `<input type="checkbox" name="verbFamily" value="${escapeHtml(family)}" checked> <span>${escapeHtml(verbFamilyLabel(family))}</span>`;
      return label;
    })
  );
}

function resetVerbQuestionSession() {
  state.verbSession = {
    answered: false,
    attempts: 0,
    selectedAnswer: "",
    result: null
  };
}

function verbSettings() {
  renderVerbFamilyOptions();
  renderVerbCommonLevelOptions();
  return {
    promptMode: $("#verbPromptMode")?.value || "mixed",
    answerMode: $("#verbAnswerMode")?.value || "type",
    practiceFocus: $("#verbPracticeFocus")?.value || "smart",
    showPronoun: $("#verbShowPronoun")?.checked ?? true,
    showInfinitive: $("#verbShowInfinitive")?.checked ?? true,
    showEnglish: $("#verbShowEnglish")?.checked ?? true,
    showPattern: $("#verbShowPattern")?.checked ?? true,
    showAccentHelp: $("#verbShowAccentHelp")?.checked ?? true,
    strictAccents: $("#verbStrictAccents")?.checked ?? false,
    showReference: $("#verbShowReference")?.checked ?? true,
    persons: checkedValues('input[name="verbPerson"]'),
    families: checkedValues('input[name="verbFamily"]'),
    commonLevels: selectedVerbCommonLevels()
  };
}

function defaultVerbRecord() {
  return {
    seen: 0,
    correct: 0,
    wrong: 0,
    streak: 0,
    level: 0,
    nextDue: 0,
    lastAt: 0
  };
}

function verbMasteryRecord(key) {
  return { ...defaultVerbRecord(), ...(state.verbMastery[key] || {}) };
}

function masteryLevelLabel(level) {
  return ["new", "lit", "warming", "steady", "strong", "anchored"][Math.max(0, Math.min(5, level))] || "new";
}

function masteryPercent(record) {
  return Math.min(100, Math.round((Math.max(0, record.level) / 5) * 100));
}

function verbItemKey(verb, personKey) {
  return `${verb.infinitive}:${personKey}`;
}

function verbQuestionPool(settings = verbSettings(), options = {}) {
  ensureVerbMemory();
  const useFocus = options.useFocus !== false;
  const fullPool = fundamentalVerbs
    .filter((verb) => settings.families.includes(verb.family))
    .filter((verb) => settings.commonLevels.includes(verbCommonLevel(verb)))
    .flatMap((verb) => settings.persons
      .filter((personKey) => verb.forms?.[personKey])
      .map((personKey) => {
        const person = verbPersonMap[personKey];
        const form = verb.forms[personKey];
        return {
          key: verbItemKey(verb, personKey),
          verb,
          person,
          personKey,
          form
        };
      }))
    .filter((item) => item.person && item.form?.cs);

  if (!useFocus) return fullPool;

  if (settings.practiceFocus === "all") {
    state.verbFocusFallback = false;
    return fullPool;
  }

  const now = Date.now();
  const focused = fullPool.filter((item) => {
    const record = verbMasteryRecord(item.key);
    if (settings.practiceFocus === "new") return !record.seen;
    if (settings.practiceFocus === "weak") return record.seen && (record.wrong > record.correct || record.level <= 2);
    if (settings.practiceFocus === "due") return record.seen && record.nextDue <= now;
    return true;
  });

  state.verbFocusFallback = !focused.length && !!fullPool.length && settings.practiceFocus !== "smart";
  return focused.length ? focused : fullPool;
}

function shuffleItems(items) {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function weightedPick(items, weightFn) {
  const weighted = items.map((item) => Math.max(0.01, weightFn(item)));
  const total = weighted.reduce((sum, weight) => sum + weight, 0);
  let target = Math.random() * total;

  for (let index = 0; index < items.length; index += 1) {
    target -= weighted[index];
    if (target <= 0) return items[index];
  }

  return items[items.length - 1];
}

function smartVerbWeight(item) {
  const record = verbMasteryRecord(item.key);
  const now = Date.now();
  let weight = 1 + (5 - Math.min(5, record.level)) * 0.78;
  if (!record.seen) weight += 2.2;
  if (record.wrong) weight += Math.min(2.5, record.wrong * 0.45);
  if (record.nextDue && record.nextDue <= now) weight += 2;
  if (record.nextDue && record.nextDue > now) weight *= 0.42;
  if (state.verbRecentKeys.includes(item.key)) weight *= 0.18;
  if (item.key === state.verbQuestion?.key) weight *= 0.05;
  return weight;
}

function pickPromptMode(settings) {
  if (settings.promptMode !== "mixed") return settings.promptMode;
  const modes = ["english", "person"];
  if (settings.answerMode !== "type") modes.push("reverse");
  return modes[Math.floor(Math.random() * modes.length)];
}

function targetAnswerFor(question) {
  return question.promptMode === "reverse" ? question.form.en : question.form.cs;
}

function answerForItem(item, promptMode) {
  return promptMode === "reverse" ? item.form.en : item.form.cs;
}

function uniqueAnswers(items, correctAnswer, promptMode) {
  const seen = new Set([correctAnswer]);
  const answers = [];

  items.forEach((item) => {
    const answer = answerForItem(item, promptMode);
    if (!answer || seen.has(answer)) return;
    seen.add(answer);
    answers.push(answer);
  });

  return answers;
}

function distractorPool(item, pool, promptMode) {
  const sameVerb = pool.filter((candidate) => candidate.verb.infinitive === item.verb.infinitive && candidate.key !== item.key);
  const samePerson = pool.filter((candidate) => candidate.personKey === item.personKey && candidate.key !== item.key);
  const sameFamily = pool.filter((candidate) => candidate.verb.family === item.verb.family && candidate.key !== item.key);
  const everythingElse = pool.filter((candidate) => candidate.key !== item.key);

  if (promptMode === "reverse") {
    return [
      ...uniqueAnswers(shuffleItems(sameVerb), answerForItem(item, promptMode), promptMode),
      ...uniqueAnswers(shuffleItems(sameFamily), answerForItem(item, promptMode), promptMode),
      ...uniqueAnswers(shuffleItems(everythingElse), answerForItem(item, promptMode), promptMode)
    ];
  }

  return [
    ...uniqueAnswers(shuffleItems(sameVerb), answerForItem(item, promptMode), promptMode),
    ...uniqueAnswers(shuffleItems(samePerson), answerForItem(item, promptMode), promptMode),
    ...uniqueAnswers(shuffleItems(sameFamily), answerForItem(item, promptMode), promptMode),
    ...uniqueAnswers(shuffleItems(everythingElse), answerForItem(item, promptMode), promptMode)
  ];
}

function buildVerbChoices(item, pool, promptMode) {
  const correctAnswer = answerForItem(item, promptMode);
  const distractors = [...new Set(distractorPool(item, pool, promptMode))]
    .filter((answer) => answer !== correctAnswer)
    .slice(0, 3);

  return shuffleItems([correctAnswer, ...distractors]).slice(0, 4);
}

function pickVerbQuestion(settings = verbSettings(), pool = verbQuestionPool(settings)) {
  if (!pool.length) return null;
  const candidates = pool.length > 1 ? pool.filter((item) => item.key !== state.verbQuestion?.key) : pool;
  const item = settings.practiceFocus === "smart"
    ? weightedPick(candidates, smartVerbWeight)
    : candidates[Math.floor(Math.random() * candidates.length)];
  const promptMode = pickPromptMode(settings);
  return { ...item, promptMode, choices: buildVerbChoices(item, pool, promptMode) };
}

function normalizeVerbAnswer(value, strictAccents) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[.!?。！？]+$/g, "")
    .replace(/\s+/g, " ");

  if (strictAccents) return normalized;

  return normalized
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function pronounAnswer(pronoun, answer) {
  const reflexive = String(answer).match(/^(.*)\s+(se|si)$/);
  if (!reflexive) return `${pronoun} ${answer}`;
  return `${pronoun} ${reflexive[2]} ${reflexive[1]}`.replace(/\s+/g, " ").trim();
}

function verbAcceptedAnswers(question, settings = verbSettings()) {
  if (question.promptMode === "reverse") {
    return [question.form.en, question.verb.english, ...(question.form.enAccepted || [])].filter(Boolean);
  }

  const answers = [question.form.cs, ...(question.form.accepted || [])].filter(Boolean);
  const withPronouns = question.person.pronouns.flatMap((pronoun) =>
    answers.map((answer) => pronounAnswer(pronoun, answer))
  );
  return [...answers, ...withPronouns];
}

function isCorrectVerbAnswer(question, value, settings) {
  const answer = normalizeVerbAnswer(value, settings.strictAccents);
  return verbAcceptedAnswers(question, settings)
    .map((accepted) => normalizeVerbAnswer(accepted, settings.strictAccents))
    .includes(answer);
}

function accentList(value) {
  return [...new Set([...String(value)].filter((char) => char.normalize("NFD") !== char))]
    .join(" ");
}

function answerModeUsesChoices(question, settings) {
  return question?.promptMode === "reverse" || settings.answerMode === "choices" || settings.answerMode === "hybrid";
}

function answerModeUsesTyping(question, settings) {
  return question?.promptMode !== "reverse" && settings.answerMode !== "choices";
}

function verbPromptLabel(question) {
  if (question.promptMode === "reverse") return "Recognize";
  if (question.promptMode === "english") return "Translate and conjugate";
  return "Conjugate";
}

function verbPromptMain(question) {
  if (question.promptMode === "reverse") return question.form.cs;
  if (question.promptMode === "english") return question.form.en;
  return question.person.label;
}

function verbPromptHint(question) {
  if (question.promptMode === "reverse") return "Choose the English meaning of this Czech form.";
  if (question.promptMode === "english") return "Give the Czech present-tense form.";
  return `Make the present form for ${question.person.english}.`;
}

function formStemForDisplay(form) {
  return String(form || "").replace(/\s+(se|si)$/u, "");
}

function answerEndingHint(question) {
  const plain = formStemForDisplay(question.form.cs);
  if (plain.length <= 3) return plain;
  if (question.verb.pattern?.includes("-ám")) return plain.slice(-2);
  if (question.verb.pattern?.includes("-ím")) return plain.slice(-2);
  if (question.verb.pattern?.includes("-uji")) return plain.slice(-3);
  return plain.slice(-2);
}

function renderVerbCues(question, settings) {
  const cues = [];
  const family = verbFamilyLabel(question.verb.family);

  cues.push(["Family", family]);
  cues.push(["Commonness", verbCommonLevelLabel(verbCommonLevel(question.verb))]);
  if (settings.showPronoun) cues.push(["Person", question.person.label]);
  if (settings.showInfinitive) cues.push(["Infinitive", question.verb.infinitive]);
  if (settings.showEnglish && question.promptMode !== "english") cues.push(["Meaning", question.verb.english]);
  if (settings.showPattern && question.verb.pattern) cues.push(["Pattern", question.verb.pattern]);
  if (question.verb.aspect) cues.push(["Aspect", question.verb.aspect]);
  if (settings.showAccentHelp && question.promptMode !== "reverse") {
    const accents = accentList(question.form.cs);
    if (accents) cues.push(["Accents", accents]);
  }
  if (question.promptMode !== "reverse") cues.push(["Ending", answerEndingHint(question)]);

  $("#verbCueList").replaceChildren(
    ...cues.map(([label, value]) => {
      const item = document.createElement("span");
      item.innerHTML = `<b>${escapeHtml(label)}</b> ${escapeHtml(value)}`;
      return item;
    })
  );
}

function renderVerbChoices(question, settings) {
  const choiceList = $("#verbChoiceList");
  const correctAnswer = targetAnswerFor(question);
  choiceList.replaceChildren(
    ...question.choices.map((choice) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "verb-choice-option";
      button.dataset.answer = choice;
      button.disabled = state.verbSession.answered;
      button.textContent = choice;
      button.setAttribute("aria-pressed", String(state.verbSession.selectedAnswer === choice));
      if (state.verbSession.answered || state.verbSession.selectedAnswer) {
        button.classList.toggle("is-selected", state.verbSession.selectedAnswer === choice);
        button.classList.toggle("is-correct", state.verbSession.answered && choice === correctAnswer);
        button.classList.toggle("is-wrong", state.verbSession.selectedAnswer === choice && choice !== correctAnswer);
      }
      return button;
    })
  );
}

function markVerbChoices(selectedAnswer) {
  const question = state.verbQuestion;
  if (!question) return;
  const correctAnswer = targetAnswerFor(question);

  document.querySelectorAll(".verb-choice-option").forEach((button) => {
    const isSelected = button.dataset.answer === selectedAnswer;
    const isCorrect = button.dataset.answer === correctAnswer;
    button.classList.toggle("is-selected", isSelected);
    button.classList.toggle("is-correct", state.verbSession.answered && isCorrect);
    button.classList.toggle("is-wrong", isSelected && !isCorrect);
    button.setAttribute("aria-pressed", String(isSelected));
    if (state.verbSession.answered) button.disabled = true;
  });
}

function updateVerbMemory(question, correct) {
  ensureVerbMemory();
  const record = verbMasteryRecord(question.key);
  record.seen += 1;
  record.lastAt = Date.now();

  if (correct) {
    record.correct += 1;
    record.streak += 1;
    record.level = Math.min(5, record.level + 1);
  } else {
    record.wrong += 1;
    record.streak = 0;
    record.level = Math.max(0, record.level - 1);
  }

  const reviewDelay = [0, 20_000, 90_000, 5 * 60_000, 30 * 60_000, 18 * 60 * 60_000][record.level] || 0;
  record.nextDue = Date.now() + reviewDelay;
  state.verbMastery[question.key] = record;
  saveVerbMemory();
}

function rememberRecentQuestion(key) {
  state.verbRecentKeys = [key, ...state.verbRecentKeys.filter((item) => item !== key)].slice(0, verbRecentLimit);
}

function renderVerbStats() {
  const stats = state.verbStats;
  const accuracy = stats.asked ? Math.round((stats.correct / stats.asked) * 100) : 0;
  $("#verbAskedCount").textContent = stats.asked;
  $("#verbCorrectCount").textContent = stats.correct;
  $("#verbStreakCount").textContent = stats.streak;
  $("#verbAccuracyCount").textContent = `${accuracy}%`;
  $("#verbBestStreakCount").textContent = stats.bestStreak;

  const settings = verbSettings();
  const activePool = verbQuestionPool(settings, { useFocus: false });
  const mastered = activePool.filter((item) => verbMasteryRecord(item.key).level >= 4).length;
  const weak = activePool.filter((item) => {
    const record = verbMasteryRecord(item.key);
    return record.seen && (record.wrong > record.correct || record.level <= 2);
  }).length;
  const masteredPercent = activePool.length ? Math.round((mastered / activePool.length) * 100) : 0;
  $("#verbMasteredCount").textContent = `${mastered}/${activePool.length}`;
  $("#verbWeakCount").textContent = weak;
  const bar = $("#verbMasteryBar");
  if (bar) bar.style.width = `${masteredPercent}%`;
}

function renderVerbOptionsVisibility() {
  const panel = $("#verbOptionsPanel");
  const toggle = $("#verbToggleOptions");
  if (!panel || !toggle) return;

  panel.hidden = !state.verbOptionsOpen;
  toggle.textContent = state.verbOptionsOpen ? "Hide options" : "Options";
  toggle.setAttribute("aria-expanded", String(state.verbOptionsOpen));
}

function toggleVerbOptions() {
  state.verbOptionsOpen = !state.verbOptionsOpen;
  renderVerbOptionsVisibility();
}

function activeVerbs(settings) {
  return fundamentalVerbs
    .filter((verb) => settings.families.includes(verb.family))
    .filter((verb) => settings.commonLevels.includes(verbCommonLevel(verb)));
}

function renderVerbFormRail(question, settings) {
  const rail = $("#verbFormRail");
  if (!rail || !question) return;

  const people = verbPersonData.filter((person) => question.verb.forms?.[person.key]);
  rail.replaceChildren(
    ...people.map((person) => {
      const form = question.verb.forms[person.key];
      const key = verbItemKey(question.verb, person.key);
      const record = verbMasteryRecord(key);
      const cell = document.createElement("div");
      cell.className = "verb-form-rail-cell";
      cell.classList.toggle("is-current", question.personKey === person.key);
      cell.classList.toggle("is-mastered", record.level >= 4);
      cell.innerHTML = `
        <span>${escapeHtml(person.label)}</span>
        <b>${escapeHtml(form.cs)}</b>
        <small>${escapeHtml(masteryLevelLabel(record.level))}</small>
      `;
      return cell;
    })
  );
}

function renderVerbCoach(question, settings) {
  const panel = $("#verbCoach");
  if (!panel) return;

  if (!question) {
    $("#verbCoachTitle").textContent = "No active card";
    $("#verbCoachMeta").textContent = "Choose at least one person, one family, and one commonness level.";
    $("#verbAnswerKey").textContent = "";
    $("#verbFormRail").replaceChildren();
    return;
  }

  const record = verbMasteryRecord(question.key);
  const answer = targetAnswerFor(question);
  $("#verbCoachTitle").textContent = `${question.verb.infinitive} · ${question.verb.english}`;
  $("#verbCoachMeta").textContent = [verbFamilyLabel(question.verb.family), verbCommonLevelLabel(verbCommonLevel(question.verb)), question.verb.pattern, question.verb.note]
    .filter(Boolean)
    .join(" · ");
  $("#verbAnswerKey").textContent = state.verbSession.answered
    ? answer
    : `${masteryLevelLabel(record.level)} · ${record.seen || 0} seen`;
  renderVerbFormRail(question, settings);
}

function renderVerbSessionLog() {
  const log = $("#verbSessionLog");
  if (!log) return;
  const entries = state.verbRecentKeys.slice(0, 6).map((key) => {
    const [infinitive, personKey] = key.split(":");
    const record = verbMasteryRecord(key);
    const item = document.createElement("span");
    item.className = "verb-log-chip";
    item.textContent = `${verbPersonMap[personKey]?.label || personKey} ${infinitive}: ${masteryLevelLabel(record.level)}`;
    return item;
  });
  log.replaceChildren(...entries);
}

function renderVerbQuestion(settings, poolLength) {
  const question = state.verbQuestion;
  const feedback = $("#verbFeedback");
  const answer = $("#verbAnswer");
  const answerControl = $(".verb-answer-control");
  const choiceList = $("#verbChoiceList");
  const checkButton = $("#verbCheckAnswer");
  const nextButton = $("#verbNextCard");

  if (!question) {
    $("#verbFamilyTag").textContent = "No deck";
    $("#verbCommonTag").textContent = "commonness";
    $("#verbCommonTag").title = "Choose one or more commonness levels.";
    $("#verbPatternTag").textContent = "present";
    $("#verbQuestionLabel").textContent = "Deck empty";
    $("#verbQuestionMain").textContent = "Select at least one person, verb family, and commonness level";
    $("#verbPromptHint").textContent = "The trainer needs one active form before it can deal a card. Check people, families, and commonness levels.";
    $("#verbCueList").replaceChildren();
    choiceList.replaceChildren();
    choiceList.hidden = true;
    answerControl.hidden = false;
    checkButton.hidden = false;
    $("#verbRoundMeta").textContent = "0 active forms";
    answer.value = "";
    answer.disabled = true;
    feedback.textContent = "";
    feedback.className = "verb-feedback";
    nextButton.textContent = "Next card";
    renderVerbCoach(null, settings);
    return;
  }

  const family = verbFamilyLabel(question.verb.family);
  const record = verbMasteryRecord(question.key);
  const useChoices = answerModeUsesChoices(question, settings);
  const useTyping = answerModeUsesTyping(question, settings);

  $("#verbFamilyTag").textContent = family;
  $("#verbCommonTag").textContent = verbCommonLevelShortLabel(verbCommonLevel(question.verb));
  $("#verbCommonTag").title = verbCommonLevelLabel(verbCommonLevel(question.verb));
  $("#verbPatternTag").textContent = question.verb.pattern || question.verb.note || "present";
  $("#verbQuestionLabel").textContent = verbPromptLabel(question);
  $("#verbQuestionMain").textContent = verbPromptMain(question);
  $("#verbPromptHint").textContent = verbPromptHint(question);
  $("#verbRoundMeta").textContent = `${poolLength} active forms · ${masteryLevelLabel(record.level)}`;
  answer.disabled = state.verbSession.answered;
  answer.placeholder = question.promptMode === "reverse" ? "Choose below" : "Type the Czech form";
  answerControl.hidden = !useTyping;
  choiceList.hidden = !useChoices;
  checkButton.hidden = !useTyping;
  nextButton.textContent = state.verbSession.answered ? "Next card" : "Skip";

  if (useChoices) renderVerbChoices(question, settings);
  else choiceList.replaceChildren();

  if (!state.verbSession.result) {
    feedback.textContent = "";
    feedback.className = "verb-feedback";
  }

  renderVerbCues(question, settings);
  renderVerbCoach(question, settings);
}

function renderVerbReference(settings) {
  const panel = $(".verb-reference-panel");
  const list = $("#verbReferenceList");
  if (!panel || !list) return;

  const persons = settings.persons
    .map((personKey) => verbPersonMap[personKey])
    .filter(Boolean);
  const search = normalizeVerbAnswer(state.verbReferenceSearch || $("#verbReferenceSearch")?.value || "", false);
  const verbs = activeVerbs(settings).filter((verb) => {
    if (!search) return true;
    return [verb.infinitive, verb.english, verb.note, verb.pattern, verb.family, verbCommonLevelLabel(verbCommonLevel(verb)), `level ${verbCommonLevel(verb)}`, `l${verbCommonLevel(verb)}`]
      .some((value) => normalizeVerbAnswer(value, false).includes(search));
  });

  panel.hidden = !settings.showReference;
  $("#verbReferenceCount").textContent = `${verbs.length} ${verbs.length === 1 ? "verb" : "verbs"}`;
  if (!settings.showReference) return;

  if (!verbs.length || !persons.length) {
    list.innerHTML = `<p class="empty-state">No active verb tables.</p>`;
    return;
  }

  list.replaceChildren(
    ...verbs.map((verb) => {
      const activeForms = persons.filter((person) => verb.forms?.[person.key]);
      const mastered = activeForms.filter((person) => verbMasteryRecord(verbItemKey(verb, person.key)).level >= 4).length;
      const card = document.createElement("article");
      card.className = "verb-reference-card";
      card.innerHTML = `
        <header>
          <div>
            <h4>${escapeHtml(verb.infinitive)}</h4>
            <p>${escapeHtml(verb.english)}</p>
          </div>
          <small>${escapeHtml([verbFamilyLabel(verb.family), verbCommonLevelShortLabel(verbCommonLevel(verb)), verb.pattern || verb.note].filter(Boolean).join(" · "))}</small>
        </header>
        <div class="verb-reference-progress" aria-label="Verb progress">
          <span style="width: ${activeForms.length ? Math.round((mastered / activeForms.length) * 100) : 0}%"></span>
        </div>
        <div class="verb-form-grid">
          ${persons.map((person) => {
            const form = verb.forms?.[person.key];
            if (!form) return "";
            const record = verbMasteryRecord(verbItemKey(verb, person.key));
            return `
              <div class="verb-form-cell${record.level >= 4 ? " is-mastered" : ""}">
                <span>${escapeHtml(person.label)}</span>
                <b>${escapeHtml(form.cs)}</b>
                <small>${escapeHtml(form.en)} · ${escapeHtml(masteryLevelLabel(record.level))}</small>
              </div>
            `;
          }).join("")}
        </div>
      `;
      return card;
    })
  );
}

function renderVerbTrainer() {
  if (!$("#view-verbs")) return;

  ensureVerbMemory();
  renderVerbFamilyOptions();
  const settings = verbSettings();
  const pool = verbQuestionPool(settings);
  const fullPool = verbQuestionPool(settings, { useFocus: false });
  const previousQuestionKey = state.verbQuestion?.key;
  $("#verbPoolCount").textContent = `${pool.length}/${fullPool.length} forms in deck`;
  const commonnessText = commonLevelSelectionLabel(settings.commonLevels);
  $("#verbFocusNote").textContent = state.verbFocusFallback
    ? `That focus had no cards, so the trainer is using the full active deck. Commonness: ${commonnessText}.`
    : `${settings.practiceFocus === "smart" ? "Smart review" : settings.practiceFocus} focus active. Commonness: ${commonnessText}.`;

  if (!pool.length) {
    state.verbQuestion = null;
    resetVerbQuestionSession();
  } else if (!state.verbQuestion || !pool.some((item) => item.key === state.verbQuestion.key)) {
    state.verbQuestion = pickVerbQuestion(settings, pool);
    resetVerbQuestionSession();
  }

  if (state.verbQuestion?.key !== previousQuestionKey) {
    const answer = $("#verbAnswer");
    if (answer) answer.value = "";
  }

  renderVerbQuestion(settings, pool.length);
  renderVerbOptionsVisibility();
  renderVerbReference(settings);
  renderVerbStats();
  renderVerbSessionLog();
}

function nextVerbQuestion() {
  const settings = verbSettings();
  const pool = verbQuestionPool(settings);
  state.verbQuestion = pickVerbQuestion(settings, pool);
  resetVerbQuestionSession();
  const answer = $("#verbAnswer");
  if (answer) answer.value = "";
  renderVerbTrainer();
  if (answerModeUsesTyping(state.verbQuestion, settings)) $("#verbAnswer")?.focus();
}

function feedbackHint(question, correct) {
  if (correct) {
    const accepted = verbAcceptedAnswers(question).slice(1, 4);
    return accepted.length ? `Also accepted: ${accepted.join(" / ")}` : "Good form. Let the ending stick.";
  }

  if (question.promptMode === "reverse") return `Answer: ${targetAnswerFor(question)}`;
  return `Look for ${question.person.label} on ${question.verb.infinitive}. Ending clue: ${answerEndingHint(question)}.`;
}

function setVerbFeedback(message, kind) {
  const feedback = $("#verbFeedback");
  feedback.textContent = message;
  feedback.className = `verb-feedback ${kind ? `is-${kind}` : ""}`.trim();
}

function finalizeVerbAnswer(question, correct, cleanValue, settings, revealed = false) {
  const firstAttempt = state.verbSession.attempts === 0;
  state.verbSession.attempts += 1;
  state.verbSession.selectedAnswer = cleanValue;

  if (firstAttempt) {
    state.verbStats.asked += 1;
    if (correct) {
      state.verbStats.correct += 1;
      state.verbStats.streak += 1;
      state.verbStats.bestStreak = Math.max(state.verbStats.bestStreak, state.verbStats.streak);
    } else {
      state.verbStats.streak = 0;
    }
    updateVerbMemory(question, correct);
    rememberRecentQuestion(question.key);
  }

  const mustResolve = revealed || correct || question.promptMode === "reverse" || settings.answerMode === "choices" || state.verbSession.attempts >= 2;
  state.verbSession.answered = mustResolve;
  state.verbSession.result = correct ? "correct" : (mustResolve ? "wrong" : "try");

  if (revealed) {
    setVerbFeedback(`Answer: ${verbAcceptedAnswers(question, settings).slice(0, 4).join(" / ")}`, "revealed");
  } else if (correct && firstAttempt) {
    setVerbFeedback(`Correct: ${targetAnswerFor(question)}. ${feedbackHint(question, true)}`, "correct");
  } else if (correct) {
    setVerbFeedback(`Recovered: ${targetAnswerFor(question)}. ${feedbackHint(question, true)}`, "correct");
  } else if (mustResolve) {
    setVerbFeedback(`Answer: ${targetAnswerFor(question)}. ${feedbackHint(question, false)}`, "wrong");
  } else {
    setVerbFeedback(`Not yet. ${feedbackHint(question, false)}`, "warn");
  }

  if (answerModeUsesChoices(question, settings)) markVerbChoices(cleanValue);
  renderVerbStats();
  renderVerbCoach(question, settings);
  renderVerbSessionLog();
  renderVerbQuestion(settings, verbQuestionPool(settings).length);
}

function submitVerbAnswer(value) {
  const question = state.verbQuestion;
  if (!question || state.verbSession.answered) return;

  const settings = verbSettings();
  const cleanValue = String(value || "").trim();

  if (!cleanValue) {
    setVerbFeedback("Add an answer first.", "warn");
    return;
  }

  const correct = isCorrectVerbAnswer(question, cleanValue, settings);
  finalizeVerbAnswer(question, correct, cleanValue, settings);
}

function checkVerbAnswer() {
  submitVerbAnswer($("#verbAnswer").value);
}

function chooseVerbAnswer(event) {
  const button = event.target.closest(".verb-choice-option");
  if (!button || button.disabled) return;
  submitVerbAnswer(button.dataset.answer);
}

function revealVerbAnswer() {
  const question = state.verbQuestion;
  if (!question || state.verbSession.answered) return;
  const settings = verbSettings();
  finalizeVerbAnswer(question, false, targetAnswerFor(question), settings, true);
}

function resetVerbProgress() {
  state.verbStats = { asked: 0, correct: 0, streak: 0, bestStreak: 0 };
  state.verbRecentKeys = [];
  resetVerbQuestionSession();
  $("#verbFeedback").textContent = "";
  $("#verbFeedback").className = "verb-feedback";
  renderVerbTrainer();
}

function clearVerbMemory() {
  const accepted = window.confirm("Clear saved verb mastery for this browser?");
  if (!accepted) return;
  state.verbMastery = {};
  saveVerbMemory();
  resetVerbProgress();
}

function insertVerbAccent(char) {
  const input = $("#verbAnswer");
  if (!input || input.disabled) return;
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  input.value = `${input.value.slice(0, start)}${char}${input.value.slice(end)}`;
  input.selectionStart = input.selectionEnd = start + char.length;
  input.focus();
}

function speakVerbAnswer() {
  const question = state.verbQuestion;
  if (!question) return;
  if (!("speechSynthesis" in window)) {
    setVerbFeedback("Speech is not available in this browser.", "warn");
    return;
  }
  const utterance = new SpeechSynthesisUtterance(question.form.cs);
  utterance.lang = "cs-CZ";
  utterance.rate = 0.86;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

function bindVerbControls() {
  renderVerbFamilyOptions();
  renderVerbCommonLevelOptions();
  const watchedSelectors = [
    "#verbPromptMode",
    "#verbAnswerMode",
    "#verbPracticeFocus",
    "#verbShowPronoun",
    "#verbShowInfinitive",
    "#verbShowEnglish",
    "#verbShowPattern",
    "#verbShowAccentHelp",
    "#verbStrictAccents",
    "#verbShowReference",
    'input[name="verbPerson"]',
    'input[name="verbFamily"]',
    'input[name="verbCommonLevel"]'
  ];

  watchedSelectors.forEach((selector) => {
    document.querySelectorAll(selector).forEach((control) => {
      control.addEventListener("change", () => {
        state.verbQuestion = null;
        resetVerbQuestionSession();
        const answer = $("#verbAnswer");
        if (answer) answer.value = "";
        renderVerbTrainer();
      });
    });
  });

  $("#verbNextCard")?.addEventListener("click", nextVerbQuestion);
  $("#verbToggleOptions")?.addEventListener("click", toggleVerbOptions);
  $("#verbCheckAnswer")?.addEventListener("click", checkVerbAnswer);
  $("#verbChoiceList")?.addEventListener("click", chooseVerbAnswer);
  $("#verbRevealAnswer")?.addEventListener("click", revealVerbAnswer);
  $("#verbResetProgress")?.addEventListener("click", resetVerbProgress);
  $("#verbResetMemory")?.addEventListener("click", clearVerbMemory);
  $("#verbSpeakAnswer")?.addEventListener("click", speakVerbAnswer);
  $("#verbAccentTray")?.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-accent]");
    if (button) insertVerbAccent(button.dataset.accent);
  });
  $("#verbReferenceSearch")?.addEventListener("input", (event) => {
    state.verbReferenceSearch = event.target.value;
    renderVerbReference(verbSettings());
  });
  $("#verbAnswer")?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (state.verbSession.answered) nextVerbQuestion();
    else checkVerbAnswer();
  });
}

function printOptions() {
  return {
    paper: $("#printPaper").value,
    orientation: $("#printOrientation").value,
    columns: Number($("#printColumns").value),
    rows: Number($("#printRows").value),
    gap: Number($("#printGap").value),
    joinMargin: Number($("#printJoinMargin").value),
    textScale: Number($("#printTextScale").value),
    sides: $("#printSides").value,
    includeGuide: $("#printIncludeGuide").checked,
    includeDictionary: $("#printIncludeDictionary").checked,
    includeScripts: $("#printIncludeScripts").checked,
    blankRows: Number($("#printBlankRows").value),
    fillBlankRows: $("#printFillBlankRows").checked,
    cutMarks: $("#printCutMarks").checked,
    pageNumbers: $("#printPageNumbers").checked
  };
}

function applyPrintDefaults() {
  $("#printOrientation").value = defaultPrintOptions.orientation;
  $("#printColumns").value = defaultPrintOptions.columns;
  $("#printRows").value = defaultPrintOptions.rows;
  $("#printGap").value = defaultPrintOptions.gap;
  $("#printJoinMargin").value = defaultPrintOptions.joinMargin;
  $("#printTextScale").value = defaultPrintOptions.textScale;
  $("#printSides").value = defaultPrintOptions.sides;
  $("#printIncludeGuide").checked = defaultPrintOptions.includeGuide;
  $("#printIncludeDictionary").checked = defaultPrintOptions.includeDictionary;
  $("#printIncludeScripts").checked = defaultPrintOptions.includeScripts;
  $("#printFillBlankRows").checked = defaultPrintOptions.fillBlankRows;
}

function paperSize(options) {
  const preset = paperPresets[options.paper] || paperPresets.a4;
  const isLandscape = options.orientation === "landscape";
  return {
    ...preset,
    width: isLandscape ? preset.height : preset.width,
    height: isLandscape ? preset.width : preset.height,
    orientation: options.orientation
  };
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function splitRows(rows, size) {
  const chunks = [];
  for (let index = 0; index < rows.length; index += size) chunks.push(rows.slice(index, index + size));
  return chunks;
}

function titledPages(type, title, rows, size) {
  return splitRows(rows, size).map((chunk, index, chunks) => ({
    type,
    title: chunks.length > 1 ? `${title} ${index + 1}/${chunks.length}` : title,
    rows: chunk
  }));
}

function guideTextPages(title, rows, layout) {
  const size = layout && layout.pageSlots <= 8 ? 8 : 6;
  return titledPages("guide", title, rows, size);
}

function guideModelPages(title, rows, layout) {
  const size = layout && layout.pageSlots <= 8 ? 4 : 3;
  return titledPages("guide-models", title, rows, size);
}

function guidePageCapacity(layout) {
  if (!layout) return 26;
  if (layout.pageSlots <= 4) return 31;
  if (layout.pageSlots <= 8) return 28;
  return 26;
}

function guideRowUnits(item, layout) {
  if (item.type === "section") return 0.9;
  if (item.type === "model-row") return layout && layout.pageSlots <= 8 ? 3.15 : 3.45;

  const leftLimit = layout && layout.pageSlots <= 8 ? 16 : 12;
  const rightLimit = layout && layout.pageSlots <= 8 ? 48 : 34;
  const lines = Math.max(
    1,
    estimatedLines(item.left, leftLimit),
    estimatedLines(item.right, rightLimit)
  );
  return lines * 1.15;
}

function packGuideItems(items, layout) {
  const capacity = guidePageCapacity(layout);
  const pages = [];
  let pageRows = [];
  let usedUnits = 0;

  const pushPage = () => {
    if (!pageRows.length) return;
    pages.push({ type: "guide-flow", title: "Guide", rows: pageRows });
    pageRows = [];
    usedUnits = 0;
  };

  items.forEach((item) => {
    const units = guideRowUnits(item, layout);
    if (pageRows.length && usedUnits + units > capacity && item.type !== "section") pushPage();
    if (item.type === "section" && pageRows.length && usedUnits + units > capacity - 1) pushPage();
    pageRows.push(item);
    usedUnits += units;
  });

  pushPage();
  return pages;
}

function guideRowsFromList(list) {
  return [...list.querySelectorAll("li")].map((item) => {
    const text = cleanText(item.textContent);
    const separator = text.indexOf(":");
    if (separator === -1) return ["Note", text];
    return [text.slice(0, separator), text.slice(separator + 1).trim()];
  });
}

function guideRowsFromCodeLedger(ledger) {
  return [...ledger.querySelectorAll("span")].map((item) => {
    const code = cleanText(item.querySelector("code")?.textContent);
    const full = cleanText(item.textContent);
    return [code, cleanText(full.slice(code.length))];
  });
}

function guideRowsFromTable(table, note) {
  const headers = [...table.querySelectorAll("thead th")].map((cell) => cleanText(cell.textContent));
  const rows = [];
  if (note) rows.push(["Note", note]);

  table.querySelectorAll("tbody tr").forEach((row) => {
    const cells = [...row.children].map((cell) => cleanText(cell.textContent));
    rows.push([
      cells[0],
      cells.slice(1).map((cell, index) => {
        const header = headers[index + 1];
        return header ? `${header}: ${cell}` : cell;
      }).join(" · ")
    ]);
  });

  return rows;
}

function modelRowsFromTable(table) {
  return [...table.querySelectorAll("tbody tr")].map((row) => {
    const cells = [...row.children];
    return {
      code: cleanText(cells[0]?.textContent),
      use: cleanText(cells[1]?.textContent),
      endings: cleanText(cells[2]?.textContent),
      cases: [...row.querySelectorAll(".case-pair")].map((pair) => {
        const label = cleanText(pair.querySelector("code")?.textContent);
        const form = cleanText(pair.textContent).slice(label.length).trim();
        return { label, form };
      })
    };
  });
}

function guideItemsFromCard(card) {
  const title = cleanText(card.querySelector("h3")?.textContent);
  if (!title) return [];

  const rows = [{ type: "section", title }];
  const note = cleanText(card.querySelector(".guide-note")?.textContent);
  const count = cleanText(card.querySelector(".count-pill")?.textContent);
  const sample = card.querySelector(".sample-entry");
  const list = card.querySelector(".plain-steps");
  const ledger = card.querySelector(".code-ledger");
  const table = card.querySelector("table");
  const addRow = ([left, right]) => rows.push({ type: "guide-row", left, right });

  if (count) addRow(["Marker", count]);
  if (sample) {
    addRow(["Sample top", [...sample.querySelectorAll(".dict-word > *")].map((node) => cleanText(node.textContent)).join(" · ")]);
    addRow(["Sample bottom", [...sample.querySelectorAll(".dict-example > *")].map((node) => cleanText(node.textContent)).join(" · ")]);
  }
  if (list) guideRowsFromList(list).forEach(addRow);
  if (ledger) guideRowsFromCodeLedger(ledger).forEach(addRow);
  if (table?.classList.contains("model-matrix")) {
    if (note) addRow(["Note", note]);
    addRow(["Columns", [...table.querySelectorAll("thead th")].map((cell) => cleanText(cell.textContent)).join(" · ")]);
    modelRowsFromTable(table).forEach((row) => rows.push({ type: "model-row", ...row }));
    return rows;
  }
  if (table) guideRowsFromTable(table, note).forEach(addRow);
  else if (note) rows.splice(1, 0, { type: "guide-row", left: "Note", right: note });

  return rows;
}

function guidePrintPages(layout) {
  const cover = {
    type: "cover",
    title: "Caatuu Czech",
    lines: ["by Waajacu", "Pocket dictionary", `${countryDictionary.length} words and phrases`, `${categories().length} groups + ${countryScripts.length} scripts`]
  };
  const guide = $("#view-guide");
  if (!guide) return [cover];

  const guidePages = [...guide.querySelectorAll(".guide-card")]
    .flatMap((card) => packGuideItems(guideItemsFromCard(card), layout))
    .map((page, index, all) => ({ ...page, title: `Guide ${index + 1}/${all.length}` }));

  return [
    cover,
    ...guidePages
  ];
}

function renderPrintDictionaryRows(rows) {
  return rows.map((row) => {
    if (row.type === "blank") {
      return `
        <div class="print-entry blank">
          <div class="print-entry-top">
            <b></b>
            <span></span>
            <small></small>
          </div>
          <div class="print-entry-bottom">
            <em></em>
            <code></code>
          </div>
        </div>
      `;
    }

    const item = row.item;
    return `
      <div class="print-entry">
        <div class="print-entry-top">
          <b>${escapeHtml(item.cs)}</b>
          <span>${escapeHtml(item.en)}</span>
          <small>${escapeHtml(item.kind)}</small>
        </div>
        <div class="print-entry-bottom">
          <em>${escapeHtml(item.use)}</em>
          <code>${escapeHtml(item.cue)}</code>
        </div>
      </div>
    `;
  }).join("");
}

function createDictionaryPageMeasure(options, layout) {
  const joinClass = measurementJoinClass(options, layout);
  const measureBook = document.createElement("section");
  measureBook.className = "print-book";
  measureBook.setAttribute("aria-hidden", "true");
  measureBook.style.cssText = [
    "display:block",
    "position:absolute",
    "left:-10000px",
    "top:0",
    "width:var(--paper-width, 297mm)",
    "padding:0",
    "visibility:hidden",
    "pointer-events:none"
  ].join(";");
  applyPrintBookVariables(measureBook, options, layout);
  measureBook.innerHTML = `
    <section class="print-sheet">
      <div class="print-grid">
        <article class="print-pocket-page${joinClass ? ` ${joinClass}` : ""}">
          <header class="print-page-head">
            <span></span>
            ${pageNumber({ logicalNumber: 999 }, options)}
          </header>
          <div class="print-page-body"></div>
        </article>
      </div>
    </section>
  `;
  document.body.append(measureBook);

  const titleNode = measureBook.querySelector(".print-page-head span:first-child");
  const body = measureBook.querySelector(".print-page-body");
  const tolerance = 1;

  const setRows = (title, rows) => {
    titleNode.textContent = title;
    body.innerHTML = renderPrintDictionaryRows(rows);
  };

  const fits = (title, rows) => {
    setRows(title, rows);
    return body.scrollHeight <= body.clientHeight + tolerance;
  };

  const fillWithBlanks = (title, rows) => {
    const filled = [...rows];
    while (filled.length < 200 && fits(title, [...filled, { type: "blank" }])) filled.push({ type: "blank" });
    return filled;
  };

  return { fits, fillWithBlanks, destroy: () => measureBook.remove() };
}

function measurementJoinClass(options, layout) {
  if (!options.joinMargin) return "";

  if (options.sides === "booklet") {
    const pairs = bookletSlotPairs(layout);
    const hasHorizontalPair = pairs.some(([firstSlot, secondSlot]) => {
      const first = slotPosition(firstSlot, layout);
      const second = slotPosition(secondSlot, layout);
      return first.row === second.row;
    });
    return hasHorizontalPair ? "join-left" : "join-top";
  }

  return "join-left";
}

function dictionaryPrintPages(options, layout) {
  const measure = createDictionaryPageMeasure(options, layout);
  try {
    return categories().flatMap((category) => {
      const rows = countryDictionary
        .filter((item) => item.cat === category)
        .map((item) => ({ type: "entry", item }));
      const blanks = Array.from({ length: options.blankRows }, () => ({ type: "blank" }));
      const allRows = [...rows, ...blanks];
      const pages = [];
      let pageRows = [];

      const pushPage = () => {
        if (!pageRows.length) return;
        pages.push({
          type: "dictionary",
          title: category,
          rows: pageRows
        });
        pageRows = [];
      };

      allRows.forEach((row) => {
        if (pageRows.length && !measure.fits(category, [...pageRows, row])) pushPage();
        pageRows.push(row);
      });

      pushPage();
      balanceDictionaryPages(category, pages, measure);
      if (options.fillBlankRows) {
        pages.forEach((page) => {
          page.rows = measure.fillWithBlanks(category, page.rows);
        });
      }

      return pages;
    });
  } finally {
    measure.destroy();
  }
}

function balanceDictionaryPages(category, pages, measure) {
  if (pages.length < 2) return;

  const lastPage = pages[pages.length - 1];
  const previousPage = pages[pages.length - 2];
  const hasManualBlanks = [...lastPage.rows, ...previousPage.rows].some((row) => row.type === "blank");
  if (hasManualBlanks) return;

  const minimumLastEntries = 3;
  const entryCount = (page) => page.rows.filter((row) => row.type === "entry").length;

  while (entryCount(lastPage) < minimumLastEntries && entryCount(previousPage) > minimumLastEntries) {
    const moved = previousPage.rows.pop();
    lastPage.rows.unshift(moved);

    if (!measure.fits(category, previousPage.rows) || !measure.fits(category, lastPage.rows)) {
      lastPage.rows.shift();
      previousPage.rows.push(moved);
      break;
    }
  }
}

function scriptPrintPages() {
  return countryScripts.map((script) => ({
    type: "script",
    title: script.title,
    goal: script.goal,
    rows: script.lines
  }));
}

function logicalPrintPages(options, layout) {
  const pages = [];

  if (options.includeGuide) pages.push(...guidePrintPages(layout));
  if (options.includeDictionary) pages.push(...dictionaryPrintPages(options, layout));
  if (options.includeScripts) pages.push(...scriptPrintPages());

  return pages.map((page, index) => ({ ...page, logicalNumber: index + 1 }));
}

function blankPocketPage() {
  return { type: "empty", title: "", rows: [] };
}

function paddedPages(pages, size) {
  const padded = [...pages];
  while (padded.length % size) padded.push(blankPocketPage());
  return padded;
}

function mirrorColumns(slots, layout) {
  const mirrored = [];
  for (let row = 0; row < layout.rows; row += 1) {
    const start = row * layout.cols;
    mirrored.push(...slots.slice(start, start + layout.cols).reverse());
  }
  return mirrored;
}

function mirrorRows(slots, layout) {
  const mirrored = [];
  for (let row = layout.rows - 1; row >= 0; row -= 1) {
    const start = row * layout.cols;
    mirrored.push(...slots.slice(start, start + layout.cols));
  }
  return mirrored;
}

function mirrorBackSlots(slots, options, layout) {
  return options.orientation === "landscape" ? mirrorRows(slots, layout) : mirrorColumns(slots, layout);
}

function landscapeRowCorrectedBackSlots(slots, options, layout) {
  const mirrored = mirrorBackSlots(slots, options, layout);
  return options.orientation === "landscape" ? mirrorRows(mirrored, layout) : mirrored;
}

function sheetLabel(sheetNumber, side) {
  return `Sheet ${sheetNumber} ${side}`;
}

function singleSidedPrintSides(pages, layout) {
  const padded = paddedPages(pages, layout.pageSlots);
  const sides = [];

  for (let start = 0; start < padded.length; start += layout.pageSlots) {
    sides.push({ label: `Sheet ${sides.length + 1}`, pages: padded.slice(start, start + layout.pageSlots) });
  }

  return sides;
}

function duplexCutStackSides(pages, options, layout) {
  const blockSize = layout.pageSlots * 2;
  const padded = paddedPages(pages, blockSize);
  const sides = [];

  for (let start = 0; start < padded.length; start += blockSize) {
    const block = padded.slice(start, start + blockSize);
    const front = [];
    const back = [];

    for (let slot = 0; slot < layout.pageSlots; slot += 1) {
      front.push(block[slot * 2] || blankPocketPage());
      back.push(block[slot * 2 + 1] || blankPocketPage());
    }

    const sheetNumber = sides.length / 2 + 1;
    sides.push({ label: sheetLabel(sheetNumber, "front"), pages: front });
    sides.push({ label: sheetLabel(sheetNumber, "back"), pages: landscapeRowCorrectedBackSlots(back, options, layout) });
  }

  return sides;
}

function bookletSlotPairs(layout) {
  const pairs = [];

  if (layout.cols % 2 === 0) {
    for (let row = 0; row < layout.rows; row += 1) {
      for (let column = 0; column + 1 < layout.cols; column += 2) {
        const left = row * layout.cols + column;
        pairs.push([left, left + 1]);
      }
    }
    return pairs;
  }

  if (layout.rows % 2 === 0) {
    for (let row = 0; row + 1 < layout.rows; row += 2) {
      for (let column = 0; column < layout.cols; column += 1) {
        const top = row * layout.cols + column;
        pairs.push([top, top + layout.cols]);
      }
    }
    return pairs;
  }

  for (let row = 0; row < layout.rows; row += 1) {
    for (let column = 0; column + 1 < layout.cols; column += 2) {
      const left = row * layout.cols + column;
      pairs.push([left, left + 1]);
    }
  }

  const lastColumn = layout.cols - 1;
  for (let row = 0; row + 1 < layout.rows; row += 2) {
    const top = row * layout.cols + lastColumn;
    pairs.push([top, top + layout.cols]);
  }

  return pairs;
}

function placeSpreadsInSlots(spreads, pairs, layout) {
  const slots = Array.from({ length: layout.pageSlots }, () => blankPocketPage());

  spreads.forEach(([leftPage, rightPage], index) => {
    const pair = pairs[index];
    if (!pair) return;
    slots[pair[0]] = leftPage;
    slots[pair[1]] = rightPage;
  });

  return slots;
}

function bookletBackSlots(slots, options, layout) {
  // Emit the back as the image sent to the printer; duplex printing mirrors it back onto the front.
  return mirrorColumns(slots, layout);
}

function slotPosition(slot, layout) {
  return {
    row: Math.floor(slot / layout.cols),
    column: slot % layout.cols
  };
}

function bookletJoinClasses(layout) {
  const classes = Array.from({ length: layout.pageSlots }, () => "");

  bookletSlotPairs(layout).forEach(([firstSlot, secondSlot]) => {
    const first = slotPosition(firstSlot, layout);
    const second = slotPosition(secondSlot, layout);

    if (first.row === second.row) {
      classes[firstSlot] = "join-right";
      classes[secondSlot] = "join-left";
    } else if (first.column === second.column) {
      classes[firstSlot] = "join-bottom";
      classes[secondSlot] = "join-top";
    }
  });

  return classes;
}

function printJoinClasses(side, options, layout) {
  if (!options.joinMargin) return Array.from({ length: layout.pageSlots }, () => "");

  if (options.sides === "booklet") return bookletJoinClasses(layout);

  if (options.sides === "duplex") {
    const isBack = side.label.endsWith("back");
    return Array.from({ length: layout.pageSlots }, () => (isBack ? "join-right" : "join-left"));
  }

  return Array.from({ length: layout.pageSlots }, () => "join-left");
}

function bookletSides(pages, options, layout) {
  const pairs = bookletSlotPairs(layout);
  const blockSize = pairs.length * 4;
  const padded = paddedPages(pages, blockSize);
  const sides = [];

  for (let start = 0; start < padded.length; start += blockSize) {
    const block = padded.slice(start, start + blockSize);
    const frontSpreads = [];
    const backSpreads = [];
    let low = 0;
    let high = block.length - 1;

    while (frontSpreads.length < pairs.length) {
      frontSpreads.push([block[high], block[low]]);

      // Build the back in front-side coordinates first: the inside page
      // must sit behind the matching outside page after duplex flipping.
      backSpreads.push([block[high - 1], block[low + 1]]);
      low += 2;
      high -= 2;
    }

    const sheetNumber = sides.length / 2 + 1;
    const frontSlots = placeSpreadsInSlots(frontSpreads, pairs, layout);
    const backSlots = placeSpreadsInSlots(backSpreads, pairs, layout);

    sides.push({ label: sheetLabel(sheetNumber, "front"), pages: frontSlots });
    sides.push({ label: sheetLabel(sheetNumber, "back"), pages: bookletBackSlots(backSlots, options, layout) });
  }

  return sides;
}

function imposedPrintSides(pages, options, layout) {
  if (options.sides === "single") return singleSidedPrintSides(pages, layout);
  if (options.sides === "booklet") return bookletSides(pages, options, layout);
  return duplexCutStackSides(pages, options, layout);
}

function printInstruction(options, layout) {
  if (options.sides === "single") {
    return "Print single-sided, cut along the lines, then stack by page number.";
  }

  if (options.sides === "booklet") {
    if (layout.pageSlots % 2 !== 0) {
      return "Print double-sided. Dotted guides show cuts. Joined sides get extra margin. This odd grid leaves one blank pocket space per side so the remaining pages can still fold into pairs.";
    }
    return "Print double-sided. Dotted guides show cuts. Joined sides get extra margin. Back sides are horizontally mirrored so they land behind the fronts. Nest the folded groups from outside to inside. If the backs land upside down, switch the printer flip edge.";
  }

  return "Print double-sided with flip on long edge. Fronts hold odd pages; backs hold the matching even pages. The binding side gets extra margin. Cut, then stack by page number.";
}

function pageNumber(page, options) {
  if (!options.pageNumbers || !page.logicalNumber) return "";
  return `<span class="print-page-number">${page.logicalNumber}</span>`;
}

function cutMarks(options) {
  if (!options.cutMarks) return "";
  return `
    <i class="print-cut-mark tl"></i>
    <i class="print-cut-mark tr"></i>
    <i class="print-cut-mark bl"></i>
    <i class="print-cut-mark br"></i>
  `;
}

function cutLinePosition(part, gap) {
  const percent = (part * 100).toFixed(4);
  const shift = (part - 0.5) * gap;
  const sign = shift < 0 ? "-" : "+";
  return `calc(${percent}% ${sign} ${Math.abs(shift).toFixed(3)}mm)`;
}

function pairKey(a, b) {
  return [a, b].sort((left, right) => left - right).join("-");
}

function bookletPairSet(layout) {
  return new Set(bookletSlotPairs(layout).map(([a, b]) => pairKey(a, b)));
}

function bookletVerticalGuide(column, layout, pairs) {
  for (let row = 0; row < layout.rows; row += 1) {
    const left = row * layout.cols + column - 1;
    const right = left + 1;
    if (!pairs.has(pairKey(left, right))) return "is-cut";
  }
  return "is-fold";
}

function bookletHorizontalGuide(row, layout, pairs) {
  for (let column = 0; column < layout.cols; column += 1) {
    const top = (row - 1) * layout.cols + column;
    const bottom = top + layout.cols;
    if (!pairs.has(pairKey(top, bottom))) return "is-cut";
  }
  return "is-fold";
}

function sheetCutLines(options, layout) {
  if (!options.cutMarks) return "";

  const lines = [];
  const pairSet = options.sides === "booklet" ? bookletPairSet(layout) : null;
  for (let column = 1; column < layout.cols; column += 1) {
    const kind = pairSet ? bookletVerticalGuide(column, layout, pairSet) : "is-cut";
    if (kind !== "is-cut") continue;
    lines.push(
      `<i class="print-cut-line vertical ${kind}" style="left: ${cutLinePosition(column / layout.cols, options.gap)}"></i>`
    );
  }
  for (let row = 1; row < layout.rows; row += 1) {
    const kind = pairSet ? bookletHorizontalGuide(row, layout, pairSet) : "is-cut";
    if (kind !== "is-cut") continue;
    lines.push(
      `<i class="print-cut-line horizontal ${kind}" style="top: ${cutLinePosition(row / layout.rows, options.gap)}"></i>`
    );
  }

  return lines.join("");
}

function renderPrintPocketPage(page, options, joinClass = "") {
  const joinClassName = joinClass ? ` ${joinClass}` : "";

  if (page.type === "empty") {
    return `<article class="print-pocket-page is-empty${joinClassName}">${cutMarks(options)}</article>`;
  }

  if (page.type === "cover") {
    return `
      <article class="print-pocket-page${joinClassName}">
        ${cutMarks(options)}
        <div class="print-cover">
          <strong>${escapeHtml(page.title)}</strong>
          ${page.lines.map((line) => `<span>${escapeHtml(line)}</span>`).join("")}
        </div>
      </article>
    `;
  }

  const head = `
    <header class="print-page-head">
      <span>${escapeHtml(page.title)}</span>
      ${pageNumber(page, options)}
    </header>
  `;

  if (page.type === "guide-flow") {
    return `
      <article class="print-pocket-page${joinClassName}">
        ${cutMarks(options)}
        ${head}
        <div class="print-page-body">
          ${page.rows.map((row) => {
            if (row.type === "section") {
              return `<div class="print-guide-section">${escapeHtml(row.title)}</div>`;
            }
            if (row.type === "model-row") {
              return `
                <div class="print-model-row">
                  <div class="print-model-label">
                    <b>${escapeHtml(row.code)}</b>
                    <small>${escapeHtml(row.use)}</small>
                  </div>
                  <div class="print-model-detail">
                    <em>${escapeHtml(row.endings)}</em>
                    <div class="print-model-cases">
                      ${row.cases.map((item) => `<span class="print-model-case"><code>${escapeHtml(item.label)}</code> ${escapeHtml(item.form)}</span>`).join("")}
                    </div>
                  </div>
                </div>
              `;
            }
            return `
              <div class="print-guide-row">
                <b>${escapeHtml(row.left)}</b>
                <span>${escapeHtml(row.right)}</span>
              </div>
            `;
          }).join("")}
        </div>
      </article>
    `;
  }

  if (page.type === "guide-models") {
    return `
      <article class="print-pocket-page${joinClassName}">
        ${cutMarks(options)}
        ${head}
        <div class="print-page-body">
          ${page.rows.map((row) => `
            <div class="print-model-row">
              <div class="print-model-label">
                <b>${escapeHtml(row.code)}</b>
                <small>${escapeHtml(row.use)}</small>
              </div>
              <div class="print-model-detail">
                <em>${escapeHtml(row.endings)}</em>
                <div class="print-model-cases">
                  ${row.cases.map((item) => `<span class="print-model-case"><code>${escapeHtml(item.label)}</code> ${escapeHtml(item.form)}</span>`).join("")}
                </div>
              </div>
            </div>
          `).join("")}
        </div>
      </article>
    `;
  }

  if (page.type === "guide") {
    return `
      <article class="print-pocket-page${joinClassName}">
        ${cutMarks(options)}
        ${head}
        <div class="print-page-body">
          ${page.rows.map(([left, right]) => `
            <div class="print-guide-row">
              <b>${escapeHtml(left)}</b>
              <span>${escapeHtml(right)}</span>
            </div>
          `).join("")}
        </div>
      </article>
    `;
  }

  if (page.type === "script") {
    return `
      <article class="print-pocket-page${joinClassName}">
        ${cutMarks(options)}
        <header class="print-page-head">
          <span>${escapeHtml(page.title)}</span>
          <span>${escapeHtml(page.goal)}</span>
        </header>
        <div class="print-page-body">
          ${page.rows.map((line) => `
            <div class="print-script-row">
              <b>${escapeHtml(line.cs)}</b>
              <span>${escapeHtml(line.en)}</span>
            </div>
          `).join("")}
        </div>
      </article>
    `;
  }

  return `
    <article class="print-pocket-page${joinClassName}">
      ${cutMarks(options)}
      ${head}
      <div class="print-page-body">
        ${renderPrintDictionaryRows(page.rows)}
      </div>
    </article>
  `;
}

function applyPrintBookVariables(book, options, layout) {
  const paper = paperSize(options);
  book.style.setProperty("--paper-width", `${paper.width}mm`);
  book.style.setProperty("--paper-height", `${paper.height}mm`);
  book.style.setProperty("--paper-ratio", `${paper.width} / ${paper.height}`);
  book.style.setProperty("--print-cols", layout.cols);
  book.style.setProperty("--print-rows", layout.rows);
  book.style.setProperty("--sheet-margin", layout.margin);
  book.style.setProperty("--print-gap", layout.gap);
  book.style.setProperty("--join-margin", `${options.joinMargin}mm`);
  book.style.setProperty("--print-word-font", scalePt(layout.wordFont, options.textScale));
  book.style.setProperty("--print-small-font", scalePt(layout.smallFont, options.textScale));
  book.style.setProperty("--print-code-font", scalePt(layout.codeFont, options.textScale));
  book.style.setProperty("--print-head-font", scalePt(layout.headFont, options.textScale));
  book.style.setProperty("--print-title-font", scalePt(layout.titleFont, options.textScale));
  book.style.setProperty("--print-translation-font", scalePt(layout.translationFont, options.textScale));
  book.style.setProperty("--print-blank-height", layout.blankHeight);
  book.style.setProperty("--print-blank-line", layout.blankLine);
}

function updatePrintBookStyles(options, layout) {
  const paper = paperSize(options);
  applyPrintBookVariables($("#printBook"), options, layout);

  let style = $("#printPageStyle");
  if (!style) {
    style = document.createElement("style");
    style.id = "printPageStyle";
    document.head.append(style);
  }
  style.textContent = `@page { size: ${paper.css} ${paper.orientation}; margin: 0; }`;
}

function buildPrintBook(options = printOptions()) {
  const layout = printLayout(options);
  const logicalPages = logicalPrintPages(options, layout);

  updatePrintBookStyles(options, layout);

  if (!logicalPages.length) {
    $("#printBook").replaceChildren();
    $("#printSummary").textContent = "Select at least one content section to build the pocket book.";
    $("#printBook").setAttribute("aria-hidden", "true");
    return { logicalPages, sides: [], physicalSheets: 0 };
  }

  const sides = imposedPrintSides(logicalPages, options, layout);

  $("#printBook").replaceChildren(
    ...sides.map((side) => {
      const sheet = document.createElement("section");
      const joinClasses = printJoinClasses(side, options, layout);
      sheet.className = "print-sheet";
      sheet.innerHTML = `
        <span class="print-sheet-label">${escapeHtml(side.label)}</span>
        <div class="print-grid">
          ${sheetCutLines(options, layout)}
          ${side.pages.map((page, index) => renderPrintPocketPage(page, options, joinClasses[index])).join("")}
        </div>
      `;
      return sheet;
    })
  );

  const physicalSheets = options.sides === "single" ? sides.length : Math.ceil(sides.length / 2);
  $("#printSummary").textContent = `${logicalPages.length} pocket pages on a ${layout.cols} x ${layout.rows} grid, ${physicalSheets} ${physicalSheets === 1 ? "paper sheet" : "paper sheets"} (${sides.length} printed ${sides.length === 1 ? "side" : "sides"}). ${printInstruction(options, layout)}`;

  $("#printBook").setAttribute("aria-hidden", "false");
  return { logicalPages, sides, physicalSheets };
}

function openPrintMenu() {
  applyPrintDefaults();
  $("#printMenu").hidden = false;
  $("#printBackdrop").hidden = false;
  buildPrintBook(printOptions());
}

function closePrintMenu() {
  $("#printMenu").hidden = true;
  $("#printBackdrop").hidden = true;
}

function previewPrintBook() {
  buildPrintBook(printOptions());
  document.body.classList.add("print-preview-on");
  closePrintMenu();
  $("#printBook").scrollIntoView({ block: "start" });
}

function printBookNow() {
  buildPrintBook(printOptions());
  document.body.classList.add("print-preview-on", "print-book-ready");
  window.print();
}

function setView(view) {
  if (!["guide", "dictionary", "verbs"].includes(view)) view = "guide";
  state.activeView = view;
  $(".view.is-active")?.classList.remove("is-active");
  $(`#view-${view}`).classList.add("is-active");
  $(".nav-tab.is-active")?.classList.remove("is-active");
  $(`.nav-tab[data-view="${view}"]`).classList.add("is-active");
  if (window.location.hash !== `#${view}`) {
    window.history.replaceState(null, "", `#${view}`);
  }
}

function setInitialViewFromHash() {
  const view = window.location.hash.replace("#", "");
  if (view) setView(view);
}

function render() {
  renderDictionary();
  renderVerbTrainer();
}

function renderDataError(error) {
  console.error(error);
  $("#dictionaryList").innerHTML = `<p class="empty-state">Could not load dictionary data. Open the app from the local server and reload.</p>`;
}

function bindUi() {
  bindPwaInstall();

  document.addEventListener("click", (event) => {
    const tab = event.target.closest(".nav-tab");
    if (tab) setView(tab.dataset.view);
  });

  window.addEventListener("hashchange", setInitialViewFromHash);

  $("#dictionarySearch")?.addEventListener("input", (event) => {
    state.dictionarySearch = event.target.value;
    renderDictionary();
  });

  applyPrintDefaults();

  $("#openPrintMenu").addEventListener("click", openPrintMenu);
  $("#closePrintMenu").addEventListener("click", closePrintMenu);
  $("#printBackdrop").addEventListener("click", closePrintMenu);
  $("#previewPrintBook").addEventListener("click", previewPrintBook);
  $("#printBookNow").addEventListener("click", printBookNow);

  [
    "#printPaper",
    "#printOrientation",
    "#printColumns",
    "#printRows",
    "#printGap",
    "#printJoinMargin",
    "#printTextScale",
    "#printSides",
    "#printIncludeGuide",
    "#printIncludeDictionary",
    "#printIncludeScripts",
    "#printBlankRows",
    "#printFillBlankRows",
    "#printCutMarks",
    "#printPageNumbers"
  ].forEach((selector) => {
    $(selector).addEventListener("change", () => buildPrintBook(printOptions()));
  });

  window.addEventListener("afterprint", () => {
    document.body.classList.remove("print-book-ready");
  });

  bindVerbControls();
}

async function init() {
  try {
    await loadContentData();
    bindUi();
    setInitialViewFromHash();
    render();
    registerServiceWorker();
  } catch (error) {
    renderDataError(error);
  }
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

init();
