import { validateVerbNebulaCatalog } from "../source/games/verb-nebula/verb-nebula-core.mjs";
import { renderTargetText } from "../source/target-text.mjs";
import { createTargetReadingGuide } from "../source/target-reading-guide.mjs";
import { arabicReadingUnits } from "../source/arabic-romanization.mjs";
import { georgianReadingUnits } from "../source/georgian-romanization.mjs";
import { russianReadingUnits } from "../source/russian-romanization.mjs";
import { fitVerbMatchLabels } from "../source/games/verb-nebula/verb-nebula-layout.mjs";

// This exact-catalog review entry is deliberately absent from production app
// catalogs. It loads no application bootstrap, models or persistent storage.
const $ = id => document.getElementById(id);
const records = new Map();
const memory = new Map();
const storage = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value) };
const picture = "/assets/macaw/actions/047-light_lantern.png";
const canvas = document.createElement("canvas").getContext("2d");
let active;
let samples = [];
let busy = false;

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function localUrl(path, base = location.href) {
  const url = new URL(path, base);
  if (url.origin !== location.origin) throw new Error(`Review resources must remain local: ${path}`);
  return url;
}

async function loadProfile(entry) {
  if (globalThis.CaatuuCourse?.id !== entry.id) {
    await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = localUrl(`${entry.routePrefix}/source/shared/course-profile.js?review=verb-layout-1`).href;
      script.addEventListener("load", () => { script.remove(); resolve(); }, { once: true });
      script.addEventListener("error", () => { script.remove(); reject(new Error(`Missing course profile: ${entry.id}`)); }, { once: true });
      document.head.append(script);
    });
  }
  const course = globalThis.CaatuuCourse;
  if (course?.id !== entry.id) throw new Error(`Course profile identity mismatch: ${entry.id}`);
  const catalogPath = course.gameContent?.["verb-lab"]?.verbNebulaCatalog;
  if (!catalogPath) throw new Error(`Course has no Verb Nebula catalog: ${entry.id}`);
  const response = await fetch(localUrl(catalogPath, localUrl(course.entryPath)), { cache: "no-store" });
  if (!response.ok) throw new Error(`${course.id} catalog returned HTTP ${response.status}`);
  const rows = await response.json();
  const pairs = validateVerbNebulaCatalog(rows, { learnerBaseLanguage: course.sourceLanguage.locale });
  records.set(course.id, { course, rows, pairs });
}

function readingUnits(record, pair) {
  if (record.course.targetLanguage.id === "ar") return arabicReadingUnits(pair.target);
  if (record.course.targetLanguage.id === "ka") return georgianReadingUnits(pair.target);
  if (record.course.targetLanguage.id === "ru") return russianReadingUnits(pair.target);
  return record.rows[pair.sourceIndex]?.reading?.tokens?.flatMap(token => token.units) ?? [];
}

function width(text, font) {
  canvas.font = font;
  return canvas.measureText(String(text)).width;
}

async function pickSamples(record, guide) {
  const probe = card(record.pairs[0], "cz", record, guide);
  $("reviewTargetColumn").replaceChildren(probe);
  probe.getBoundingClientRect();
  await document.fonts.ready;
  const copy = probe.querySelector(".verb-match-card-copy");
  const font = getComputedStyle(copy.querySelector(".caatuu-target-text-glyph") || copy).font;
  const notationFont = getComputedStyle(copy.querySelector(".caatuu-target-text-notation") || copy).font;
  const rank = (score) => [...record.pairs].sort((a, b) => score(b) - score(a));
  const wholeWord = pair => Math.max(...pair.target.split(/\s+/u).map(word => width(word, font)));
  const reading = pair => Math.max(0, ...readingUnits(record, pair)
    .map(unit => width(unit.notation ?? "", notationFont)));
  const chosen = [];
  const add = (pair, reason) => {
    if (pair && !chosen.some(sample => sample.pair.id === pair.id)) chosen.push({ pair, reason });
  };
  add(record.pairs[0], "ordinary");
  add(rank(wholeWord)[0], "widest target word");
  add(rank(reading)[0], "widest reading");
  add(rank(pair => width(pair.target, font))[0], "widest phrase");
  for (const pair of rank(wholeWord)) {
    if (chosen.length === 4) break;
    add(pair, "additional long target");
  }
  if (chosen.length !== 4) throw new Error(`${record.course.id} needs four distinct review samples`);
  return chosen;
}

function card(pair, side, record, guide) {
  const button = node("button", `verb-match-card verb-match-card-${side}`);
  button.type = "button";
  button.dataset.verbId = pair.id;
  button.dataset.verbSide = side;
  button.setAttribute("aria-pressed", "false");
  const copy = node("span", "verb-match-card-copy", side === "cz" ? pair.target : pair.source);
  const language = side === "cz" ? record.course.targetLanguage : record.course.sourceLanguage;
  copy.lang = language.locale;
  copy.dir = language.direction || "auto";
  if (side === "cz") {
    if (guide.available) guide.render(copy, pair.target);
    else renderTargetText(document, copy, pair.target, { units: readingUnits(record, pair),
      showGuide: $("reviewReadings").checked, colorTones: true, guideLanguage: "zh-Latn-pinyin" });
  }
  button.append(copy);
  return button;
}

async function render(id) {
  active = records.get(id);
  if (!active) throw new Error(`Unknown review course: ${id}`);
  const { course } = active;
  globalThis.CaatuuCourse = course;
  document.body.dataset.courseId = course.id;
  document.body.dataset.targetScript = course.targetLanguage.script;
  $("reviewCourse").value = course.id;
  $("reviewBoardTitle").textContent = `${course.targetLanguage.label} — four real catalog samples`;
  $("reviewTargetHeading").textContent = course.targetLanguage.label;
  $("reviewSourceHeading").textContent = course.sourceLanguage.label;
  const guide = createTargetReadingGuide({ course, gameId: "verb-layout-review", document, storage });
  guide.setEnabled($("reviewReadings").checked);
  samples = await pickSamples(active, guide);
  $("reviewTargetColumn").replaceChildren();
  $("reviewSourceColumn").replaceChildren();
  for (const { pair, reason } of samples) {
    const row = node("div", "verb-match-card-row verb-match-card-row-cz");
    row.dataset.verbRowId = pair.id;
    row.dataset.reviewReason = reason;
    const hint = node("span", "verb-match-hint-slot");
    hint.hidden = !$("reviewHints").checked;
    const image = node("img");
    image.src = picture;
    image.alt = "Fixed review picture";
    hint.append(image);
    row.append(hint, card(pair, "cz", active, guide));
    $("reviewTargetColumn").append(row);
    $("reviewSourceColumn").append(card(pair, "en", active, guide));
  }
  await Promise.all([...document.querySelectorAll(".verb-match-hint-slot img")]
    .map(image => image.decode().catch(() => {})));
  await document.fonts.ready;
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  fitVerbMatchLabels(document.querySelector(".verb-match-board"));
  await new Promise(resolve => requestAnimationFrame(resolve));
}

function inside(inner, outer, tolerance = 1.5) {
  return inner.left >= outer.left - tolerance && inner.right <= outer.right + tolerance
    && inner.top >= outer.top - tolerance && inner.bottom <= outer.bottom + tolerance;
}

function textRectangles(host) {
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  const rectangles = [];
  while (walker.nextNode()) {
    const range = document.createRange();
    range.selectNodeContents(walker.currentNode);
    rectangles.push(...range.getClientRects());
  }
  return rectangles.filter(rect => rect.width > 0.1 && rect.height > 0.1);
}

function measure() {
  const failures = [];
  const board = document.querySelector(".verb-match-board");
  const bounds = board.getBoundingClientRect();
  const viewport = document.documentElement.clientWidth;
  if (bounds.left < -1 || bounds.right > viewport + 1) failures.push("board exceeds viewport");
  const cases = samples.map(({ pair, reason }) => {
    const row = [...$("reviewTargetColumn").children].find(row => row.dataset.verbRowId === pair.id);
    const button = row.querySelector(".verb-match-card");
    const hint = row.querySelector(".verb-match-hint-slot");
    const rect = row.getBoundingClientRect(), cardRect = button.getBoundingClientRect();
    const issues = [];
    if (!inside(rect, bounds)) issues.push("row exceeds board");
    if (!inside(cardRect, rect)) issues.push("card exceeds row");
    if (textRectangles(button).some(rectangle => !inside(rectangle, cardRect))) issues.push("target or reading overflows card");
    if (!hint.hidden) {
      const hintRect = hint.getBoundingClientRect();
      const image = hint.querySelector("img");
      if (!image.complete || image.naturalWidth === 0) issues.push("review picture failed to load");
      if (!inside(hintRect, rect) || !inside(image.getBoundingClientRect(), hintRect)) issues.push("picture overflows row");
      const overlap = Math.min(hintRect.bottom, cardRect.bottom) - Math.max(hintRect.top, cardRect.top);
      if (overlap <= 0 || Math.abs((hintRect.top + hintRect.bottom - cardRect.top - cardRect.bottom) / 2) > 1.5) {
        issues.push("picture and target are on different lines");
      }
      if (Math.min(hintRect.right, cardRect.right) - Math.max(hintRect.left, cardRect.left) > 1.5) issues.push("picture overlaps target");
    }
    if (active.course.targetLanguage.direction === "rtl") {
      const copy = button.querySelector(".verb-match-card-copy");
      if (copy.dir !== "rtl" || getComputedStyle(copy).direction !== "rtl") issues.push("Arabic target lost RTL direction");
      if (copy.querySelector(".caatuu-arabic-reading")?.dir === "ltr") issues.push("Arabic reading run lost RTL direction");
    }
    const meaning = [...$("reviewSourceColumn").children].find(card => card.dataset.verbId === pair.id);
    const meaningRect = meaning.getBoundingClientRect();
    if (!inside(meaningRect, bounds) || textRectangles(meaning).some(rectangle => !inside(rectangle, meaningRect))) {
      issues.push("meaning overflows its card or board");
    }
    failures.push(...issues.map(issue => `${pair.id}: ${issue}`));
    return { id: pair.id, target: pair.target, meaning: pair.source, reason, issues };
  });
  return { courseId: active.course.id, viewport, fontSize: $("reviewFont").value,
    hints: $("reviewHints").checked, readings: $("reviewReadings").checked,
    passed: failures.length === 0, failures, cases };
}

function publish(reports) {
  const failures = reports.reduce((count, report) => count + report.failures.length, 0);
  const report = { passed: failures === 0, courses: reports.length, viewport: document.documentElement.clientWidth,
    failureCount: failures, reports };
  $("reviewReport").value = JSON.stringify(report, null, 2);
  $("reviewSummary").textContent = `${report.passed ? "PASS" : "FAIL"}: ${reports.length} course(s), ${failures} issue(s), viewport ${report.viewport}px.`;
  document.documentElement.dataset.reviewStatus = report.passed ? "pass" : "fail";
  return report;
}

async function check(all = false) {
  if (busy) return;
  busy = true;
  const original = $("reviewCourse").value;
  $("reviewCheck").disabled = $("reviewCheckAll").disabled = true;
  try {
    const reports = [];
    for (const id of all ? records.keys() : [original]) {
      await render(id);
      reports.push(measure());
    }
    if (all) await render(original);
    return publish(reports);
  } finally {
    busy = false;
    $("reviewCheck").disabled = $("reviewCheckAll").disabled = false;
  }
}

function failure(error) {
  document.documentElement.dataset.reviewStatus = "error";
  $("reviewSummary").textContent = error.message;
  $("reviewReport").value = String(error.stack || error);
}

async function initialize() {
  const courses = [...(globalThis.CaatuuCourse?.courseSelector?.courses ?? [])];
  if (!courses.length) throw new Error("The canonical course selector is unavailable");
  for (const entry of courses) await loadProfile(entry);
  for (const { course } of records.values()) {
    const option = node("option", "", `${course.id} — ${course.targetLanguage.label}`);
    option.value = course.id;
    $("reviewCourse").append(option);
  }
  const selected = new URL(location.href).searchParams.get("course") || "ar";
  $("reviewCourse").value = records.has(selected) ? selected : records.keys().next().value;
  $("reviewCourse").disabled = false;
  $("reviewCheck").disabled = $("reviewCheckAll").disabled = false;
  $("reviewCheck").addEventListener("click", () => check().catch(failure));
  $("reviewCheckAll").addEventListener("click", () => check(true).catch(failure));
  for (const id of ["reviewCourse", "reviewHints", "reviewReadings", "reviewFont"]) {
    $(id).addEventListener("change", () => {
      document.documentElement.dataset.fontSize = $("reviewFont").value;
      check().catch(failure);
    });
  }
  window.addEventListener("resize", () => { if (!busy && active) check().catch(failure); });
  globalThis.CaatuuVerbNebulaLayoutReview = Object.freeze({ checkAll: () => check(true), checkSelected: () => check(), measure });
  await check(true);
  document.documentElement.dataset.reviewReady = "true";
}

initialize().catch(failure);
