import assert from "node:assert/strict";
import test from "node:test";
import { fitVerbMatchLabels } from "../static/source/games/verb-nebula/verb-nebula-layout.mjs";
import { createTargetReadingGuide } from "../static/source/target-reading-guide.mjs";
import { createBrowserHarness } from "./helpers/fake-browser.mjs";

function fixture({ available = 100, required = 160, rubyWidth = required, plain = false } = {}) {
  const browser = createBrowserHarness();
  const board = browser.document.createElement("div");
  const button = browser.document.createElement("button");
  const label = browser.document.createElement("span");
  label.className = "verb-match-card-copy";
  label.dir = "rtl";
  button.append(label);
  board.append(button);
  browser.document.body.append(board);
  const guide = createTargetReadingGuide({ course: { id: "ar", targetLanguage: { id: "ar" } },
    gameId: "verb-lab", document: browser.document,
    storage: { getItem: () => null, setItem() {} } });
  if (plain) label.textContent = "an unbroken label";
  else guide.render(label, "اسْتَيْقَظَ");
  const dimensions = { available, required, rubyWidth };
  const scale = () => Number(label.style.getPropertyValue("--verb-label-scale")) || 1;
  // A zoomed item's CSS-pixel width can grow while its physical slot remains
  // fixed. Measurements expose that distinction rather than a style snapshot.
  Object.defineProperties(label, {
    clientWidth: { get: () => dimensions.available / scale() },
    scrollWidth: { configurable: true, get: () => Math.max(dimensions.required, label.clientWidth) },
  });
  const ruby = label.querySelector("ruby");
  if (ruby) ruby.getBoundingClientRect = () => ({ width: dimensions.rubyWidth * scale() });
  return { ...browser, board, button, label, ruby, dimensions, scale };
}

test("an overflowing joined Arabic word and reading fit together without replacing their text or nodes", () => {
  const f = fixture({ available: 90, required: 165 });
  const before = f.label.textContent;
  const glyph = f.label.querySelector(".caatuu-target-text-glyph");
  const notation = f.label.querySelector("rt");
  f.button.focus();
  fitVerbMatchLabels(f.board);
  assert.ok(f.scale() > 0 && f.scale() < 1);
  assert.ok(f.ruby.getBoundingClientRect().width <= f.dimensions.available);
  assert.equal(f.label.textContent, before);
  assert.equal(f.label.querySelectorAll("ruby").length, 1);
  assert.equal(f.label.querySelector("ruby"), f.ruby);
  assert.equal(f.label.querySelector(".caatuu-target-text-glyph"), glyph);
  assert.equal(f.label.querySelector("rt"), notation);
  assert.equal(glyph.textContent, "اسْتَيْقَظَ");
  assert.equal(notation.dir, "ltr");
  assert.equal(f.label.dir, "rtl");
  assert.equal(f.document.activeElement, f.button);
});

test("labels that already fit retain their chosen size and other presentation settings", () => {
  const f = fixture({ available: 180, required: 100 });
  f.label.style.setProperty("color", "green");
  fitVerbMatchLabels(f.board);
  assert.equal(f.scale(), 1);
  assert.equal(f.label.style.getPropertyValue("--verb-label-scale"), "");
  assert.equal(f.label.style.getPropertyValue("color"), "green");
});

test("repeated narrow measurements are stable and a wider viewport restores the original chosen size", () => {
  const f = fixture({ available: 85, required: 170 });
  fitVerbMatchLabels(f.board);
  const narrowScale = f.scale();
  fitVerbMatchLabels(f.board);
  assert.equal(f.scale(), narrowScale, "Refitting a scaled label must not compound its zoom");
  f.dimensions.available = 240;
  fitVerbMatchLabels(f.board);
  assert.equal(f.scale(), 1);
  assert.equal(f.label.style.getPropertyValue("--verb-label-scale"), "");
  f.dimensions.available = 85;
  fitVerbMatchLabels(f.board);
  assert.equal(f.scale(), narrowScale);
});

test("hidden zero-width boards skip content measurement and recover when shown", () => {
  const f = fixture({ available: 0, required: 150 });
  Object.defineProperty(f.label, "scrollWidth", { configurable: true,
    get() { throw new Error("Hidden content must not be measured"); } });
  assert.doesNotThrow(() => fitVerbMatchLabels(f.board));
  assert.equal(f.scale(), 1);
  Object.defineProperty(f.label, "scrollWidth", { get: () => Math.max(f.dimensions.required, f.label.clientWidth) });
  f.dimensions.available = 100;
  fitVerbMatchLabels(f.board);
  assert.ok(f.ruby.getBoundingClientRect().width <= f.dimensions.available);
  assert.doesNotThrow(() => fitVerbMatchLabels(null));
});

test("a whole-word ruby wider than its label scroll box still determines the required width", () => {
  const f = fixture({ available: 100, required: 100, rubyWidth: 205 });
  fitVerbMatchLabels(f.board);
  assert.ok(f.scale() < 1);
  assert.ok(f.ruby.getBoundingClientRect().width <= f.dimensions.available,
    "An overflowing reading must fit even when scrollWidth reports only the label box");
});

test("plain target or meaning labels use the same bounded fitting behavior", () => {
  const f = fixture({ available: 95, required: 180, plain: true });
  const before = f.label.textContent;
  fitVerbMatchLabels(f.board);
  assert.ok(f.dimensions.required * f.scale() <= f.dimensions.available);
  assert.equal(f.label.textContent, before);
  assert.equal(f.label.querySelector("ruby"), null);
});
