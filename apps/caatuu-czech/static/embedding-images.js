const sourceKinds = ["image_asset", "macaw_action_asset"];
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

function setStatus(message) {
  if (status) status.textContent = message;
}

function parseJsonObject(value) {
  if (!value || typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    return {};
  }
}

function rowMetadata(row) {
  return row?.documentMetadata && typeof row.documentMetadata === "object"
    ? row.documentMetadata
    : parseJsonObject(row?.documentMetadataJson || row?.document_metadata_json);
}

function rowSourceKind(row) {
  return String(row?.sourceKind || row?.source_kind || "");
}

function rowImagePath(row) {
  const metadata = rowMetadata(row);
  const path = String(row?.sourceId || row?.source_id || metadata.asset_path || metadata.path || "").trim();
  if (!path) return "";
  if (path.startsWith("/")) return path;
  if (path.startsWith("assets/")) return `/${path}`;
  return path;
}

function sourceLabel(sourceKind) {
  return sourceKind === "macaw_action_asset" ? "Macaw actions" : "Miscellaneous";
}

function normalizeRows(payload) {
  const rows = Array.isArray(payload?.results) ? payload.results : [];
  return rows
    .map((row) => {
      const sourceKind = rowSourceKind(row);
      const metadata = rowMetadata(row);
      const path = rowImagePath(row);
      return {
        sourceKind,
        sourceLabel: sourceLabel(sourceKind),
        path,
        title: String(row?.title || metadata.title || "").trim(),
        description: String(row?.text || metadata.description || metadata.label || path).trim(),
        score: Number(row?.score || 0)
      };
    })
    .filter((row) => sourceKinds.includes(row.sourceKind) && row.path);
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

  const miscellaneous = rows.filter((row) => row.sourceKind === "image_asset").slice(0, 12);
  const actions = rows.filter((row) => row.sourceKind === "macaw_action_asset").slice(0, 12);
  if (miscellaneous.length) results.append(renderGroup("Miscellaneous", miscellaneous));
  if (actions.length) results.append(renderGroup("Macaw actions", actions));
}

async function searchSourceKind(runtime, text, sourceKind) {
  return runtime.vector.search(text, { limit: 16, sourceKinds: [sourceKind] });
}

async function runSearch() {
  const text = prompt?.value.trim() || "";
  if (!text) {
    setStatus("Write an English prompt first.");
    return;
  }

  const runtime = window.CaatuuRuntime;
  if (!runtime?.vector?.search) {
    setStatus("Vector runtime is not available.");
    return;
  }

  if (runButton) runButton.disabled = true;
  if (randomButton) randomButton.disabled = true;
  setStatus("Searching local vectors.");
  try {
    const payloads = await Promise.all(sourceKinds.map((sourceKind) => searchSourceKind(runtime, text, sourceKind)));
    const rows = payloads.flatMap(normalizeRows);
    renderResults(rows);
    setStatus(`${rows.length} image matches.`);
  } catch (error) {
    renderResults([]);
    setStatus(error?.message || "Image search failed.");
  } finally {
    if (runButton) runButton.disabled = false;
    if (randomButton) randomButton.disabled = false;
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
  pickRandomPrompt();
  runSearch();
});

prompt?.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    runSearch();
  }
});
