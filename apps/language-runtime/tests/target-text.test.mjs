import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { renderTargetText } from "../static/source/target-text.mjs";
import { createBrowserHarness } from "./helpers/fake-browser.mjs";

const units = [{ surface: "需", notation: "xū" }, { surface: "要", notation: "yào" }];
function harness() {
  const browser = createBrowserHarness();
  const host = browser.document.createElement("button");
  browser.document.body.append(host);
  return { ...browser, host };
}

test("the shared renderer pairs each glyph with its own ruby reading above it", () => {
  const { document, host } = harness();
  assert.equal(renderTargetText(document, host, "需要", { units, guideLanguage: "zh-Latn-pinyin" }), true);
  assert.equal(host.children[0].className, "caatuu-target-text");
  const characters = host.querySelectorAll(".caatuu-target-text-unit");
  assert.equal(characters.length, 2);
  for (const [index, character] of characters.entries()) {
    assert.equal(character.tagName, "RUBY");
    assert.equal(character.children[0].className, "caatuu-target-text-glyph");
    assert.equal(character.children[0].textContent, units[index].surface);
    assert.equal(character.children[1].tagName, "RT");
    assert.equal(character.children[1].textContent, units[index].notation);
    assert.equal(character.children[1].lang, "zh-Latn-pinyin");
    assert.equal(character.children[1].getAttribute("aria-hidden"), "true");
  }
  assert.deepEqual(characters.map(character => character.dataset.tone), ["1", "4"]);
});

test("reading visibility and tone colors are independent and rerender without stale annotations", () => {
  const { document, host } = harness();
  host.focus();
  for (const showGuide of [true, false]) {
    for (const colorTones of [true, false]) {
      assert.equal(renderTargetText(document, host, "需要", { units, showGuide, colorTones }), true);
      assert.equal(host.classList.contains("has-target-text-guide"), showGuide);
      assert.equal(host.classList.contains("has-target-text-colors"), colorTones);
      assert.equal(host.querySelectorAll("rt").length, showGuide ? 2 : 0);
      assert.equal(host.querySelectorAll("[data-tone]").length, colorTones ? 2 : 0);
      assert.equal(host.querySelectorAll("ruby").length, showGuide ? 2 : 0);
      assert.equal(host.querySelectorAll(".caatuu-target-text-glyph").map(glyph => glyph.textContent).join(""), "需要");
      assert.equal(document.activeElement, host);
    }
  }
});

test("explicit contextual tones win while missing tones use marked, numbered or neutral notation", () => {
  const { document, host } = harness();
  const contextual = [{ surface: "好", notation: "hǎo", tone: 4 },
    { surface: "好", notation: "hao3" }, { surface: "谢", notation: "xie", tone: 0 },
    { surface: "𠮷", notation: "jí" }];
  renderTargetText(document, host, "好好谢𠮷", { units: contextual });
  assert.deepEqual(host.querySelectorAll(".caatuu-target-text-unit").map(unit => unit.dataset.tone), ["4", "3", "5", "2"]);
  assert.equal(host.querySelectorAll(".caatuu-target-text-glyph").at(-1).textContent, "𠮷");
});

test("incomplete or malformed alignment falls back atomically and clears previous guide flags", () => {
  const { document, host } = harness();
  for (const invalid of [undefined, null, [], {}, [null], [units[0]], [...units].reverse(),
    [{ surface: "需要", notation: "" }], [{ surface: "需要", notation: "  " }],
    [{ surface: "需要", notation: 4 }], [{ surface: 1, notation: "xū" }]]) {
    renderTargetText(document, host, "需要", { units });
    assert.equal(renderTargetText(document, host, "需要", { units: invalid }), false);
    assert.equal(host.textContent, "需要");
    assert.equal(host.children.length, 0);
    assert.equal(host.classList.contains("has-target-text-guide"), false);
    assert.equal(host.classList.contains("has-target-text-colors"), false);
  }
  assert.equal(renderTargetText(document, null, "需要", { units }), false);
});

test("the renderer treats supplied surfaces and notation as literal text", () => {
  const { document, host } = harness();
  const surface = '<img src="x">';
  renderTargetText(document, host, surface, { units: [{ surface, notation: "<script>" }] });
  assert.equal(host.querySelector(".caatuu-target-text-glyph").textContent, surface);
  assert.equal(host.querySelector("rt").textContent, "<script>");
  assert.equal(host.querySelector("img, script"), null);
  assert.equal(renderTargetText(document, host, "e\u0301", { units: [{ surface: "é", notation: "é" }] }), true);
  assert.equal(host.querySelector(".caatuu-target-text-glyph").textContent, "é");
});

test("Word World delegates its provider reading and current preferences to the same renderer", async () => {
  const browser = harness();
  const source = await readFile(new URL("../static/source/product-word-world.mjs", import.meta.url), "utf8");
  const start = source.indexOf("function targetTextUnits(prepared)"), end = source.indexOf("function abortWordLookup()", start);
  assert.ok(start >= 0 && end > start);
  const prepared = { conceptId: "fixture", tokenIndex: 1 }, lookups = [];
  const providerContext = { targetTextGuide: { languageTag: "zh-Latn-pinyin" },
    targetTextUnits(request) { lookups.push(request); return units; } };
  const state = { targetTextPreferences: { showGuide: true, colorTones: false } };
  Object.assign(browser.context, { renderTargetText, providerContext, state });
  vm.runInContext(source.slice(start, end), browser.context);
  assert.equal(browser.context.replaceTargetText(browser.host, "需要", prepared), true);
  assert.equal(lookups[0], prepared);
  assert.equal(browser.host.querySelectorAll(".caatuu-target-text-unit").length, 2);
  assert.equal(browser.host.querySelectorAll("[data-tone]").length, 0);
  assert.equal(browser.host.querySelector("rt").lang, "zh-Latn-pinyin");

  state.targetTextPreferences.showGuide = false;
  state.targetTextPreferences.colorTones = true;
  browser.context.replaceTargetText(browser.host, "需要", prepared);
  assert.equal(browser.host.querySelector("rt"), null);
  assert.equal(browser.host.querySelectorAll("[data-tone]").length, 2);
  providerContext.targetTextUnits = () => { throw new Error("no authored reading for this token"); };
  assert.equal(browser.context.replaceTargetText(browser.host, "需要", prepared), false);
  assert.equal(browser.host.textContent, "需要");
  browser.context.providerContext = null;
  assert.equal(browser.context.replaceTargetText(browser.host, "plain", null), false);
  assert.equal(browser.host.textContent, "plain");
});

test("shared styles wrap complete ruby units and retain static Naturalization aliases", async () => {
  const css = await readFile(new URL("../static/styles/caatuu-target-text.css", import.meta.url), "utf8");
  const run = css.match(/\.caatuu-target-text,\s*\.word-net-target-text\s*\{([^}]+)\}/u)?.[1] || "";
  assert.match(run, /flex-wrap:\s*wrap;/u);
  assert.match(run, /max-width:\s*100%;/u);
  const unit = css.match(/\.caatuu-target-text-unit,\s*\.word-net-target-text-unit\s*\{([^}]+)\}/u)?.[1] || "";
  assert.match(unit, /ruby-position:\s*over;/u);
  assert.match(unit, /white-space:\s*nowrap;/u);
  assert.match(unit, /flex:\s*none;/u);
  assert.match(unit, /break-inside:\s*avoid;/u);
  assert.match(css, /\.word-net-target-text-notation/u);
});
