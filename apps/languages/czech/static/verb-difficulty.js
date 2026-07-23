import { extractCoreVerbPairs } from "./verb-nebula-core.mjs";

const levels = [
  { value: 1, name: "Explorer", note: "Essential everyday verbs" },
  { value: 2, name: "Traveler", note: "Useful range and common situations" },
  { value: 3, name: "Navigator", note: "Broader and more nuanced vocabulary" }
];

const groups = document.querySelector("#verbDifficultyGroups");
const total = document.querySelector("#verbDifficultyTotal");

function coreVerbs(dictionary) {
  return extractCoreVerbPairs(dictionary)
    .map((entry) => ({
      czech: entry.cz,
      english: entry.eng,
      difficulty: entry.difficulty
    }))
    .sort((left, right) => left.czech.localeCompare(right.czech, "cs", { sensitivity: "base" }));
}

function renderVerbRow(entry) {
  const row = document.createElement("div");
  row.className = "verb-difficulty-row";

  const czech = document.createElement("span");
  czech.className = "verb-difficulty-czech";
  czech.lang = "cs";
  czech.textContent = entry.czech;

  const english = document.createElement("span");
  english.className = "verb-difficulty-english";
  english.lang = "en";
  english.textContent = entry.english;

  row.append(czech, english);
  return row;
}

function renderGroup(level, verbs) {
  const section = document.createElement("section");
  section.className = "verb-difficulty-group";
  section.setAttribute("aria-labelledby", `verbDifficultyLevel${level.value}`);

  const header = document.createElement("header");
  header.className = "verb-difficulty-group-head";
  const copy = document.createElement("div");
  const eyebrow = document.createElement("p");
  eyebrow.className = "verb-difficulty-level";
  eyebrow.textContent = `Level ${level.value} · ${level.note}`;
  const heading = document.createElement("h2");
  heading.id = `verbDifficultyLevel${level.value}`;
  heading.textContent = level.name;
  copy.append(eyebrow, heading);

  const count = document.createElement("span");
  count.className = "verb-difficulty-count";
  count.textContent = `${verbs.length} verbs`;
  header.append(copy, count);

  const list = document.createElement("div");
  list.className = "verb-difficulty-list";
  if (verbs.length) list.append(...verbs.map(renderVerbRow));
  else {
    const empty = document.createElement("p");
    empty.className = "verb-difficulty-empty";
    empty.textContent = "No verbs are assigned to this level.";
    list.append(empty);
  }

  section.append(header, list);
  return section;
}

async function loadVerbDifficultyCatalog() {
  try {
    const response = await fetch("data/dictionary.json?v=verb-difficulty-1", { cache: "no-store" });
    if (!response.ok) throw new Error(`Dictionary request failed (${response.status}).`);
    const dictionary = await response.json();
    if (!Array.isArray(dictionary)) throw new Error("Dictionary data is not a list.");
    const verbs = coreVerbs(dictionary);
    groups?.replaceChildren(
      ...levels.map((level) => renderGroup(
        level,
        verbs.filter((verb) => verb.difficulty === level.value)
      ))
    );
    if (total) total.textContent = `${verbs.length} assigned verbs`;
  } catch (error) {
    const message = document.createElement("p");
    message.className = "verb-difficulty-error";
    message.textContent = error instanceof Error ? error.message : "Could not load the difficulty catalog.";
    groups?.replaceChildren(message);
    if (total) total.textContent = "Unavailable";
  }
}

void loadVerbDifficultyCatalog();
