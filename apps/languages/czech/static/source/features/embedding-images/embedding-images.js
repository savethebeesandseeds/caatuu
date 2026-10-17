import { isChildFacingMacawActionAssetAllowed } from "../../shared/child-facing-assets.mjs?v=child-facing-assets-2";
import { IMAGE_SOURCES, createEnglishImageSearch } from "/language-runtime/static/source/english-image-search.mjs?v=english-image-search-5";

const sourceKinds = IMAGE_SOURCES.map(({ kind }) => kind);
const searchImages = createEnglishImageSearch();
const promptSamples = [
  "a child reads a book at home",
  "a small house in a green garden",
  "a macaw waves hello",
  "a spaceship flies near the sun",
  "a student listens at school",
  "a macaw plays music",
  "a boat moves on blue water",
  "a teacher writes with a pen"
];

const prompt = document.querySelector("#embeddingDebugText");
const form = document.querySelector("#embeddingDebugForm");
const runButton = document.querySelector("#embeddingDebugRun");
const randomButton = document.querySelector("#embeddingDebugRandom");
const status = document.querySelector("#embeddingDebugStatus");
const results = document.querySelector("#embeddingDebugResults");
let searching = false;
let searchRequest = 0;
let pageHidden = false;

function syncSearchControls() {
  if (runButton) runButton.disabled = searching || pageHidden;
  if (randomButton) randomButton.disabled = searching || pageHidden;
}

function cancelPendingSearch() {
  searchRequest += 1;
  if (searching) setStatus("Search interrupted. Try again.");
  searching = false;
  syncSearchControls();
}

function setStatus(message) {
  if (status) status.textContent = message;
}

function sourceLabel(sourceKind) {
  return {
    image_asset: "Miscellaneous",
    macaw_action_asset: "Macaw actions",
    robot_asset: "Robots",
    ship_asset: "Spaceships"
  }[sourceKind] || sourceKind;
}

function normalizeRows(payload) {
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  return rows
    .map((row) => {
      const sourceKind = String(row?.sourceKind || "");
      const path = String(row?.path || "");
      return {
        ...row,
        sourceKind,
        sourceLabel: sourceLabel(sourceKind),
        path,
        action: String(row?.action || "").trim(),
        title: String(row?.title || "").trim(),
        description: String(row?.description || path).trim(),
        score: Number(row?.score || 0)
      };
    })
    .filter((row) => (
      sourceKinds.includes(row.sourceKind)
      && row.path
      && (row.sourceKind !== "macaw_action_asset"
        || isChildFacingMacawActionAssetAllowed(row.path, row.action))
    ));
}

function scoreLabel(score) {
  return Number.isFinite(score) ? `${Math.round(score * 100)}%` : "";
}

function renderCard(row) {
  const card = document.createElement("figure");
  card.className = "embedding-debug-card";

  const image = document.createElement("img");
  image.src = row.path;
  image.alt = row.description || row.title || "Asset image";
  image.loading = "lazy";

  const missing = document.createElement("span");
  missing.className = "embedding-debug-missing";
  missing.hidden = true;
  missing.textContent = "Missing image";

  image.addEventListener("error", () => {
    image.hidden = true;
    card.classList.add("is-missing");
    missing.hidden = false;
  }, { once: true });

  const caption = document.createElement("figcaption");
  const label = document.createElement("strong");
  label.textContent = row.title || row.description;
  const meta = document.createElement("small");
  meta.textContent = [row.sourceLabel, scoreLabel(row.score)].filter(Boolean).join(" - ");
  const path = document.createElement("span");
  path.textContent = row.path;
  caption.append(label, meta, path);
  card.append(image, missing, caption);
  return card;
}

function renderGroup(title, rows) {
  const section = document.createElement("section");
  section.className = "embedding-debug-result-group";
  const heading = document.createElement("h2");
  heading.textContent = title;
  const grid = document.createElement("div");
  grid.className = "embedding-debug-result-grid";
  rows.forEach((row) => grid.append(renderCard(row)));
  section.append(heading, grid);
  return section;
}

function renderResults(rows) {
  if (!results) return;
  results.replaceChildren();
  if (!rows.length) {
    const empty = document.createElement("p");
    empty.className = "embedding-debug-empty";
    empty.textContent = "No local image matches found.";
    results.append(empty);
    return;
  }

  for (const sourceKind of sourceKinds) {
    const group = rows.filter((row) => row.sourceKind === sourceKind).slice(0, 12);
    if (group.length) results.append(renderGroup(sourceLabel(sourceKind), group));
  }
}

async function runSearch() {
  if (searching || pageHidden || document.visibilityState === "hidden") return;
  const text = prompt?.value.trim() || "";
  if (!text) {
    setStatus("Write an English prompt first.");
    return;
  }

  const request = ++searchRequest;
  searching = true;
  syncSearchControls();
  setStatus("Searching local vectors.");
  try {
    const payload = await searchImages(text);
    if (request !== searchRequest) return;
    const rows = normalizeRows(payload);
    renderResults(rows);
    setStatus(`${rows.length} ${payload.mode === "lexical" ? "keyword" : "image"} matches.`);
  } catch (error) {
    if (request !== searchRequest) return;
    renderResults([]);
    setStatus(error?.message || "Image search failed.");
  } finally {
    if (request === searchRequest) { searching = false; syncSearchControls(); }
  }
}

function pickRandomPrompt() {
  const index = Math.floor(Math.random() * promptSamples.length);
  if (prompt) prompt.value = promptSamples[index] || promptSamples[0];
}

form?.addEventListener("submit", (event) => {
  event.preventDefault();
  runSearch();
});

randomButton?.addEventListener("click", () => {
  if (searching || pageHidden) return;
  pickRandomPrompt();
  runSearch();
});

prompt?.addEventListener("keydown", (event) => {
  if (event.defaultPrevented || event.repeat || event.isComposing || event.keyCode === 229 || event.altKey) return;
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    runSearch();
  }
});

window.addEventListener("pagehide", () => { pageHidden = true; cancelPendingSearch(); });
window.addEventListener("pageshow", () => { pageHidden = false; syncSearchControls(); });
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") cancelPendingSearch();
});
