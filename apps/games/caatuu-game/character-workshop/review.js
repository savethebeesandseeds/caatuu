"use strict";
import { animationTick } from "./animation-clock.mjs";

const $ = (id) => document.getElementById(id);
const names = { N: "North", NE: "Northeast", E: "East", SE: "Southeast", S: "South", SW: "Southwest", W: "West", NW: "Northwest" };
const order = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const authored = ["S", "N", "E", "SE", "NE"];
const defaults = order.map((id) => ({ id, source: ({ NW: "NE", W: "E", SW: "SE" })[id] || id, mirror: ["NW", "W", "SW"].includes(id) }));
const phaseNames = ["Contact", "Passing", "Opposite contact", "Passing"];
const runPhaseNames = ["Near contact", "Near support", "Flight", "Far contact", "Far support", "Flight"];
const cycleAction = () => state.action === "run" ? "run" : "walk";
const cycleLength = () => cycleAction() === "run" ? 6 : 4;
const actionTitle = () => cycleAction() === "run" ? "Run" : "Walk";
const hasRun = () => frames.has("E-run-01");
const availableDirections = () => cycleAction() === "run" ? ["E", "W"] : order;
const state = { direction: "S", action: "walk", phase: 1, fps: 6, playing: true, background: "dark", scale: "medium" };
let manifest = { frames: [], directions: defaults, expected_originals: 25, blockers: [] };
let frames = new Map();
let directionMap = new Map(defaults.map((entry) => [entry.id, entry]));
const imageCache = new Map();
const cards = new Map();
let lastTick = 0;
let refreshing = false;
let initialized = false;

function text(tag, value, className) {
  const node = document.createElement(tag);
  node.textContent = value;
  if (className) node.className = className;
  return node;
}

function sourceUrl(frame) {
  if (!frame || typeof frame.file !== "string") return null;
  if (!/^(?:\.\/)?images\/[a-z0-9][a-z0-9._-]*\.png$/i.test(frame.file)) return null;
  const url = new URL(frame.file, location.href);
  const root = new URL("./images/", location.href);
  if (url.origin !== root.origin || !url.pathname.startsWith(root.pathname) || url.search || url.hash) return null;
  if (typeof frame.sha256 === "string" && /^[0-9a-f]{64}$/.test(frame.sha256)) url.searchParams.set("v", frame.sha256);
  return url.href;
}

function preload(frame) {
  const url = sourceUrl(frame);
  if (!url || imageCache.has(url)) return;
  const record = { status: "loading", image: new Image() };
  imageCache.set(url, record);
  record.image.onload = () => { record.status = "loaded"; updateLoadAudit(); renderMain(); renderCards(); };
  record.image.onerror = () => { record.status = "error"; updateLoadAudit(); renderMain(); renderCards(); markSheetError(frame.id); };
  record.image.src = url;
}

function frameFor(direction, action, phase) {
  const mapping = directionMap.get(direction) || defaults.find((entry) => entry.id === direction);
  const id = action === "idle" ? `${mapping.source}-idle` : `${mapping.source}-${action}-${String(phase).padStart(2, "0")}`;
  return { id, frame: frames.get(id), mirror: Boolean(mapping.mirror) };
}

function setImage(image, placeholder, selection, label) {
  const url = sourceUrl(selection.frame);
  const record = imageCache.get(url);
  const loaded = record && record.status === "loaded";
  image.hidden = !loaded;
  placeholder.hidden = Boolean(loaded);
  image.classList.toggle("mirrored", selection.mirror);
  image.alt = label;
  if (loaded && image.src !== url) image.src = url;
  placeholder.textContent = !selection.frame ? "Frame pending" : !url ? "Invalid image path" : record && record.status === "error" ? "Image failed to load" : "Loading frame…";
}

function alphaLabel(frame) {
  const alpha = frame.alpha;
  if (!alpha || alpha.transparent_fraction === null || alpha.transparent_fraction === undefined) return "alpha unverified";
  if (!alpha.has_alpha_channel) return "no alpha channel";
  return alpha.transparent_fraction > 0 ? `${(alpha.transparent_fraction * 100).toFixed(1)}% transparent pixels` : "opaque alpha";
}

function renderMain() {
  const selection = frameFor(state.direction, state.action, state.phase);
  const label = `${names[state.direction]} · ${state.action === "idle" ? "Standing" : `${actionTitle()} ${state.phase}/${cycleLength()}`}${selection.mirror ? " · Mirrored" : ""}`;
  $("stage").dataset.direction = state.direction;
  $("stage").dataset.frame = selection.id;
  $("stage").dataset.phase = state.action === "idle" ? "0" : String(state.phase);
  $("current-label").textContent = label;
  $("stage-id").textContent = `${selection.id}${selection.mirror ? " · mirrored" : ""}`;
  setImage($("hero"), $("stage-empty"), selection, `${names[state.direction]} macaw ${state.action === "idle" ? "standing" : `${state.action === "run" ? "running" : "walking"} frame ${state.phase}`}`);
  $("scrubber").max = String(cycleLength());
  $("scrubber").value = String(state.phase);
  $("scrubber").disabled = state.action === "idle";
  $("phase-label").textContent = state.action === "idle" ? "Standing" : `${state.phase}/${cycleLength()} · ${(cycleAction() === "run" ? runPhaseNames : phaseNames)[state.phase - 1]}`;
  $("play").textContent = state.playing ? "Pause" : "Play";
  $("play").setAttribute("aria-pressed", String(state.playing));
  for (const button of document.querySelectorAll("#compass button")) {
    button.setAttribute("aria-pressed", String(button.dataset.direction === state.direction));
    button.disabled = !availableDirections().includes(button.dataset.direction);
  }
  $("run-action").disabled = !hasRun();
  $("direction-help").textContent = state.action === "run" ? "Running preview: east and mirrored west." : "Walking and standing: all eight directions.";
  for (const button of document.querySelectorAll("#action-controls button")) button.setAttribute("aria-pressed", String(button.dataset.action === state.action));
  for (const [id, card] of cards) card.button.setAttribute("aria-pressed", String(id === state.direction));
  const url = sourceUrl(selection.frame);
  $("original-link").hidden = !url;
  if (url) $("original-link").href = url;
  $("image-metadata").textContent = selection.frame ? `${selection.frame.width || "?"} × ${selection.frame.height || "?"} · ${alphaLabel(selection.frame)}${selection.mirror ? " · source shown via horizontal mirror" : ""}` : "This latest sheet frame has not been added yet.";
  $("visual-notes").textContent = selection.frame ? selection.frame.visual_notes || "Sheet-derived frame on a common centered canvas. Draft gait for motion review." : "Use Refresh files when the latest processed frames are ready. Missing frames remain empty.";
}

function buildCards() {
  $("direction-cards").replaceChildren();
  cards.clear();
  $("directions-heading").textContent = state.action === "run" ? "Run in both directions" : "All eight directions";
  $("directions-caption").textContent = state.action === "run" ? "Six-frame run · west mirrors east" : "Synchronized four-frame walks · three views use mirrors";
  $("direction-cards").classList.toggle("run-cards", state.action === "run");
  for (const id of availableDirections()) {
    const mapping = directionMap.get(id);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "direction-card";
    button.dataset.direction = id;
    button.setAttribute("aria-label", `Review ${names[id]}${mapping.mirror ? ", mirrored" : ""}`);
    const stage = text("span", "", `card-stage bg-${state.background}`);
    const image = new Image();
    image.hidden = true;
    const placeholder = text("span", "Loading…", "card-missing");
    stage.append(image, placeholder);
    const label = text("span", "", "card-label");
    label.append(text("span", id), text("small", mapping.mirror ? "mirror" : "authored"));
    button.append(stage, label);
    button.addEventListener("click", () => { state.direction = id; state.action = cycleAction(); renderMain(); });
    $("direction-cards").append(button);
    cards.set(id, { button, stage, image, placeholder });
  }
}

function renderCards() {
  for (const [id, card] of cards) {
    const selection = frameFor(id, cycleAction(), state.phase);
    card.button.dataset.frame = selection.id;
    card.button.dataset.phase = String(state.phase);
    setImage(card.image, card.placeholder, selection, `${names[id]} ${cycleAction() === "run" ? "running" : "walking"} frame ${state.phase}`);
  }
}

function buildSheet() {
  const sheet = $("contact-sheet");
  sheet.replaceChildren();
  const running = state.action === "run";
  sheet.classList.toggle("run-sheet", running);
  $("contact-heading").textContent = running ? "Latest running frames" : "Latest walking frames";
  $("contact-caption").textContent = running ? "Six poses · one complete run cycle" : "Standing + contact / passing / opposite contact / passing";
  const headings = running ? ["Direction", ...runPhaseNames.map((name,i) => `${String(i+1).padStart(2,"0")} · ${name}`)] : ["Direction", "Standing", "01 · Contact", "02 · Passing", "03 · Contact", "04 · Passing"];
  for (const heading of headings) sheet.append(text("div", heading, "sheet-heading"));
  for (const direction of running ? ["E"] : authored) {
    sheet.append(text("div", `${direction}\n${names[direction]}`, "row-label"));
    for (let phase = running ? 1 : 0; phase <= (running ? 6 : 4); phase += 1) {
      const selection = frameFor(direction, running ? "run" : phase ? "walk" : "idle", phase);
      const url = sourceUrl(selection.frame);
      const cell = document.createElement(url ? "a" : "div");
      cell.className = `sheet-cell${url ? "" : " missing"}`;
      cell.dataset.frame = selection.id;
      if (url) {
        cell.href = url;
        cell.target = "_blank";
        cell.rel = "noopener";
        cell.setAttribute("aria-label", `Open latest sheet frame ${selection.id}`);
        const holder = text("div", "", "sheet-image");
        const image = new Image();
        image.alt = `${names[direction]} ${running ? `run ${phase}` : phase ? `walk ${phase}` : "standing"}`;
        image.src = url;
        image.addEventListener("error", () => { image.hidden = true; holder.append(text("span", "Load failed")); cell.classList.add("failed"); });
        holder.append(image);
        cell.append(holder, text("span", selection.id));
      } else cell.append(text("span", "Pending"), text("span", selection.id));
      sheet.append(cell);
    }
  }
}

function markSheetError(id) {
  for (const cell of document.querySelectorAll(".sheet-cell")) if (cell.dataset.frame === id) cell.classList.add("failed");
}

function updateLoadAudit() {
  const valid = manifest.frames.map((frame) => ({ frame, url: sourceUrl(frame) }));
  const loaded = valid.filter(({ url }) => imageCache.get(url)?.status === "loaded").length;
  const failed = valid.filter(({ url }) => !url || imageCache.get(url)?.status === "error");
  $("load-count").textContent = `${loaded} / ${valid.length} loaded`;
  $("load-detail").textContent = failed.length ? `${failed.length} image error${failed.length === 1 ? "" : "s"}` : loaded === valid.length ? "All listed images loaded" : "Preloading latest frame PNGs…";
  $("load-errors").replaceChildren(...failed.map(({ frame, url }) => text("li", `${frame.id}: ${url ? "image request failed" : "invalid or unsupported image path"}`)));
}

function renderAudit() {
  const expected = manifest.expected_frames || manifest.expected_originals || 25;
  const transparent = manifest.frames.filter((frame) => frame.alpha?.transparent_fraction > 0).length;
  const unknown = manifest.frames.filter((frame) => frame.alpha?.transparent_fraction === null || frame.alpha?.transparent_fraction === undefined).length;
  $("frame-count").textContent = `${manifest.frames.length} / ${expected}`;
  $("alpha-count").textContent = `${transparent} / ${manifest.frames.length}${unknown ? ` · ${unknown} unverified` : ""}`;
  const processing = typeof manifest.processing_summary === "string" ? manifest.processing_summary : typeof manifest.processing_status === "string" ? manifest.processing_status : "Latest sheet-derived frames on a common centered canvas. Gait is a draft; inspect the cycle and foot placement.";
  $("processing-status").textContent = processing;
  $("generation-status").textContent = manifest.complete ? `All ${expected} latest sheet frames are listed. ${processing}` : `${manifest.frames.length} of ${expected} latest sheet frames are listed. Missing slots remain visible. ${processing}`;
  $("blockers").replaceChildren(...(manifest.blockers || []).map((blocker) => text("li", String(blocker))));
  const date = new Date(manifest.generated_at);
  $("updated-at").textContent = Number.isNaN(date.valueOf()) ? "" : `Manifest: ${date.toLocaleString()}`;
  updateLoadAudit();
}

async function refreshManifest() {
  if (refreshing) return;
  refreshing = true;
  $("refresh").disabled = true;
  $("refresh").textContent = "Reading…";
  $("page-error").hidden = true;
  try {
    const response = await fetch("./manifest.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`Manifest request returned HTTP ${response.status}.`);
    const incoming = await response.json();
    if (!Array.isArray(incoming.frames)) throw new Error("Manifest has no frames array.");
    const known = incoming.frames.filter((frame) => frame && /^(?:[A-Z]{1,2}-(idle|walk-0[1-4])|E-run-0[1-6])$/.test(frame.id));
    manifest = { ...incoming, frames: known };
    frames = new Map(known.map((frame) => [frame.id, frame]));
    if (!initialized) {
      if (hasRun()) Object.assign(state, {direction:"E", action:"run", phase:1, fps:10});
      $("fps").value = String(state.fps);
      initialized = true;
    } else if (state.action === "run" && !hasRun()) {
      Object.assign(state, {action:"walk", phase:1});
    }
    directionMap = new Map(defaults.map((fallback) => {
      const found = Array.isArray(incoming.directions) ? incoming.directions.find((entry) => entry.id === fallback.id && authored.includes(entry.source)) : null;
      return [fallback.id, found || fallback];
    }));
    for (const frame of known) {
      const url = sourceUrl(frame);
      if (imageCache.get(url)?.status === "error") imageCache.delete(url);
      preload(frame);
    }
    buildCards();
    buildSheet();
    renderAudit();
    renderMain();
    renderCards();
  } catch (error) {
    $("page-error").textContent = `${error.message} This review needs its manifest.json and images directory beside the page.`;
    $("page-error").hidden = false;
    $("load-count").textContent = "Manifest unavailable";
    $("load-detail").textContent = "Refresh after the files are ready";
  } finally {
    refreshing = false;
    $("refresh").disabled = false;
    $("refresh").textContent = "Refresh files";
  }
}

function step(delta) {
  state.playing = false;
  state.action = cycleAction();
  const count = cycleLength();
  state.phase = ((state.phase - 1 + delta + count) % count) + 1;
  renderMain();
  renderCards();
}

$("compass").addEventListener("click", (event) => { const button = event.target.closest("button[data-direction]"); if (button) { state.direction = button.dataset.direction; renderMain(); } });
$("action-controls").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button || button.disabled) return;
  state.action = button.dataset.action;
  state.phase = 1;
  if (state.action === "run" && !["E","W"].includes(state.direction)) state.direction = "E";
  state.fps = state.action === "run" ? 10 : 6;
  $("fps").value = String(state.fps);
  lastTick = 0;
  buildCards(); buildSheet(); renderMain(); renderCards();
});
$("background-controls").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-background]");
  if (!button) return;
  const previous = state.background;
  state.background = button.dataset.background;
  for (const target of [$("stage"), ...Array.from(cards.values(), (card) => card.stage)]) { target.classList.remove(`bg-${previous}`); target.classList.add(`bg-${state.background}`); }
  for (const item of document.querySelectorAll("#background-controls button")) item.setAttribute("aria-pressed", String(item === button));
});
$("scale").addEventListener("change", (event) => { $("stage").classList.remove(`size-${state.scale}`); state.scale = event.target.value; $("stage").classList.add(`size-${state.scale}`); });
$("fps").addEventListener("change", (event) => { state.fps = Number(event.target.value); lastTick = 0; });
$("play").addEventListener("click", () => { state.playing = !state.playing; if (state.playing) state.action = cycleAction(); lastTick = 0; renderMain(); });
$("previous").addEventListener("click", () => step(-1));
$("next").addEventListener("click", () => step(1));
$("scrubber").addEventListener("input", (event) => { state.playing = false; state.action = cycleAction(); state.phase = Number(event.target.value); renderMain(); renderCards(); });
$("refresh").addEventListener("click", refreshManifest);

function animate(now) {
  if (state.playing && !document.hidden) {
    const tick = animationTick(now, lastTick, state.fps);
    if (tick.advance) {
      lastTick = tick.previous;
      state.phase = state.phase % cycleLength() + 1;
      if (state.action !== "idle") renderMain();
      renderCards();
    }
  }
  requestAnimationFrame(animate);
}

buildCards();
renderMain();
renderCards();
refreshManifest();
requestAnimationFrame(animate);
