import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import * as verbNebulaCore from "../static/source/games/verb-nebula/verb-nebula-core.mjs";
import * as verbTargetTextRenderer from "../static/source/target-text.mjs";
import { createBrowserHarness } from "./helpers/fake-browser.mjs";

const workspace = await readFile(new URL("../static/source/caatuu-workspace.js", import.meta.url), "utf8");
const course = JSON.parse(await readFile(new URL("../../languages/mandarin-simplified/course.json", import.meta.url), "utf8"));
function between(start, end) {
  const first = workspace.indexOf(start), last = workspace.indexOf(end, first);
  assert.ok(first >= 0 && last > first, `Missing actual workspace functions: ${start}`);
  return workspace.slice(first, last);
}
function row(id, target, source, notations) {
  return { id, kind: "verb", target, source, difficulty: 1, usefulness: 80, complexity: 1,
    reading: { system: "pinyin", tokens: [{ surface: target,
      units: Array.from(target, (surface, index) => ({ surface, notation: notations[index] })) }] } };
}
const rows = [row("return", "还", "return something borrowed", ["huán"]),
  row("thank", "谢谢", "thank", ["xiè", "xie"]), row("pour", "倒", "pour", ["dào"])];

function harness({ selectedCourse = course, catalog = rows, saved = {} } = {}) {
  const browser = createBrowserHarness({ course: selectedCourse, localStorageValues: saved });
  const pairs = verbNebulaCore.validateVerbNebulaCatalog(catalog, { learnerBaseLanguage: "en" });
  const state = { activeView: "verbs", trainTab: "verb-lab", verbRound: pairs, verbEnglishRound: pairs,
    verbMatchedIds: new Set(), verbWrongIds: new Set(), verbRoundNumber: 7,
    verbSelectedCzechId: pairs[0]?.id, verbSelectedEnglishId: "", verbRoundTransitionId: 12,
    verbStats: { attempts: 4, matches: 2 }, verbSolutionRevealed: false };
  const calls = { choose: 0, arrows: 0, rounds: 0 };
  Object.assign(browser.context, { course: selectedCourse, state, verbTargetTextRenderer,
    sourceLanguage: selectedCourse.sourceLanguage, targetLanguage: selectedCourse.targetLanguage,
    $: (selector) => browser.document.querySelector(selector),
    verbGuidedInteractionLocked: () => false, verbGuidedTargetPending: () => false,
    renderVerbHintSlot: () => browser.document.createElement("span"),
    interfaceText: (id) => id, toggleVerbHints() {}, renderVerbAudioControls() {},
    chooseVerbMatchCard() { calls.choose += 1; },
    renderVerbSolutionArrows() { calls.arrows += 1; },
    renderVerbNebula() { calls.rounds += 1; }, closeVerbToolbarMenus() {}
  });
  vm.runInContext([
    between("const verbTargetTextStorageKey =", "const defaultModelKey ="),
    between("function verbUsesTargetTextGuide()", "function applyVerbLanguageCopy()"),
    between("function createVerbMatchCard(pair, side)", "function verbMatchCardForId"),
    between("function bindVerbNebulaControls()", "function printOptions()")
  ].join("\n"), browser.context);
  browser.context.verbTargetTextReadings = browser.context.indexVerbTargetTextReadings(catalog);
  state.verbTargetTextPreferences = browser.context.loadVerbTargetTextPreferences();
  function node(tag, id, parent) {
    const element = browser.document.createElement(tag);
    if (id) element.id = id;
    parent.append(element);
    return element;
  }
  const panel = node("section", "trainPanelVerbLab", browser.document.body);
  const controls = node("section", "verbTargetTextSettings", panel);
  const tones = node("button", "verbTargetTextToneColors", controls);
  tones.dataset.verbTargetTextSetting = "colorTones";
  const guide = node("button", "verbTargetTextNotation", controls);
  guide.dataset.verbTargetTextSetting = "showGuide";
  const column = node("div", "verbCzechColumn", panel);
  const meanings = node("div", "verbEnglishColumn", panel);
  pairs.forEach((pair) => {
    column.append(browser.context.createVerbMatchCard(pair, "cz"));
    meanings.append(browser.context.createVerbMatchCard(pair, "en"));
  });
  browser.context.renderVerbTargetTextControls();
  browser.context.bindVerbNebulaControls();
  const click = (target, event = {}) => target.dispatchEvent({ type: "click", bubbles: true, ...event });
  const card = (id) => column.querySelector(`[data-verb-id="${id}"]`);
  return { ...browser, state, calls, panel, controls, tones, guide, column, meanings, click, card };
}

test("Mandarin cards use their own authored sense readings, tone colors and neutral syllables by default", () => {
  const game = harness();
  assert.equal(game.controls.hidden, false);
  assert.equal(game.tones.getAttribute("aria-checked"), "true");
  assert.equal(game.guide.getAttribute("aria-checked"), "true");
  assert.equal(game.card("return").querySelector(".caatuu-target-text-notation").textContent, "huán");
  assert.equal(game.card("pour").querySelector(".caatuu-target-text-unit[data-tone]").dataset.tone, "4");
  assert.deepEqual(game.card("thank").querySelectorAll(".caatuu-target-text-unit[data-tone]").map((glyph) => glyph.dataset.tone), ["4", "5"]);
  assert.equal(game.card("thank").querySelector(".caatuu-target-text-notation").lang, "zh-Latn-pinyin");
  const syllables = game.card("thank").querySelectorAll("ruby");
  assert.equal(syllables.length, 2, "each character uses the shared ruby renderer");
  assert.deepEqual(syllables.map((unit) => unit.querySelector("rt").textContent), ["xiè", "xie"]);
  assert.ok(syllables.every((unit) => unit.querySelector("rt").getAttribute("aria-hidden") === "true"));
  assert.equal(game.card("thank").querySelectorAll(".verb-match-card-reading").length, 0);
  assert.equal(game.meanings.children[0].textContent, "return something borrowed");
  assert.equal(game.meanings.querySelectorAll(".caatuu-target-text-unit[data-tone], .caatuu-target-text-notation").length, 0);
});

test("reading switches preserve active cards, focus, feedback and round ownership while persisting independently", () => {
  const game = harness();
  const originalCard = game.card("return"), originalRound = game.state.verbRound;
  const before = JSON.stringify({ ...game.state, verbTargetTextPreferences: null });
  originalCard.focus();
  game.click(game.tones);
  assert.equal(game.card("return"), originalCard);
  assert.equal(game.document.activeElement, originalCard);
  assert.equal(game.state.verbRound, originalRound);
  assert.equal(game.card("return").querySelector(".caatuu-target-text-unit[data-tone]"), null);
  assert.equal(game.card("return").querySelector(".caatuu-target-text-notation").textContent, "huán");
  assert.equal(game.tones.getAttribute("aria-checked"), "false");
  game.click(game.guide);
  assert.equal(game.card("return").textContent, "还");
  assert.equal(game.guide.getAttribute("aria-checked"), "false");
  assert.equal(JSON.stringify({ ...game.state, verbTargetTextPreferences: null }), before);
  assert.deepEqual(game.calls, { choose: 0, arrows: 0, rounds: 0 });

  const reopened = harness({ saved: game.localStorage.snapshot() });
  assert.equal(reopened.tones.getAttribute("aria-checked"), "false");
  assert.equal(reopened.guide.getAttribute("aria-checked"), "false");
  reopened.click(reopened.tones);
  assert.equal(reopened.card("return").querySelector(".caatuu-target-text-unit[data-tone]").dataset.tone, "2");
  assert.equal(reopened.card("return").querySelector(".caatuu-target-text-notation"), null);

  const anotherCourse = structuredClone(course);
  anotherCourse.storage.namespace += ".another-course";
  const independent = harness({ selectedCourse: anotherCourse, saved: game.localStorage.snapshot() });
  assert.equal(independent.tones.getAttribute("aria-checked"), "true");
  assert.equal(independent.guide.getAttribute("aria-checked"), "true");
});

test("missing, malformed and stale reading metadata stays plain instead of borrowing another word's pronunciation", () => {
  const invalid = [row("missing", "看", "see", ["kàn"]), row("mismatch", "还", "return", ["huán"]),
    row("badnotation", "说", "speak", ["<script>"]), row("badalignment", "谢谢", "thank", ["xiè", "xie"])];
  delete invalid[0].reading;
  invalid[1].reading.tokens[0].surface = "回";
  invalid[3].reading.tokens[0].units[0].surface = "再";
  const game = harness({ catalog: invalid });
  assert.equal(game.column.querySelectorAll(".caatuu-target-text-notation, .caatuu-target-text-unit[data-tone]").length, 0);
  assert.equal(game.card("mismatch").textContent, "还");

  const valid = harness();
  const copy = valid.card("return").querySelector(".verb-match-card-copy");
  valid.context.renderVerbTargetTextCopy(copy, { id: "return", target: "回" });
  assert.equal(copy.textContent, "回", "an old ID does not authorize a reading for a different surface");
});

test("readings align Unicode characters and stay attached to identity for homographs", () => {
  const seed = row("seed", "种", "seed", ["zhǒng"]);
  const game = harness({ catalog: [row("plant", "种", "plant", ["zhòng"]),
    seed, row("supplementary", "𠀀", "fixture", ["hē"])] });
  assert.equal(game.card("plant").querySelector(".caatuu-target-text-unit[data-tone]").dataset.tone, "4");
  // The matching core intentionally deduplicates homographs; reading lookup must
  // still preserve each authored identity rather than keying by surface alone.
  const seedCopy = game.document.createElement("span");
  game.context.renderVerbTargetTextCopy(seedCopy, seed);
  assert.equal(seedCopy.querySelector(".caatuu-target-text-unit[data-tone]").dataset.tone, "3");
  assert.equal(game.card("supplementary").querySelector(".caatuu-target-text-glyph").textContent, "𠀀");
});

test("non-Mandarin courses hide the controls and leave target and source labels unchanged", () => {
  const otherCourse = structuredClone(course);
  otherCourse.linguisticFeatures = [];
  const game = harness({ selectedCourse: otherCourse });
  assert.equal(game.controls.hidden, true);
  assert.equal(game.tones.disabled, true);
  assert.equal(game.card("return").textContent, "还");
  game.click(game.tones);
  assert.equal(game.localStorage.length, 0);
  assert.equal(game.state.verbTargetTextPreferences.colorTones, true);
});

test("unusable preferences recover safely and denied storage still allows session changes", () => {
  const game = harness();
  const key = vm.runInContext("verbTargetTextStorageKey", game.context);
  for (const saved of ["{", "null", '{"colorTones":"false","showGuide":0}']) {
    const recovered = harness({ saved: { [key]: saved } });
    assert.equal(recovered.tones.getAttribute("aria-checked"), "true");
    assert.equal(recovered.guide.getAttribute("aria-checked"), "true");
  }
  const partial = harness({ saved: { [key]: '{"colorTones":false}' } });
  assert.equal(partial.tones.getAttribute("aria-checked"), "false");
  assert.equal(partial.guide.getAttribute("aria-checked"), "true");
  game.localStorage.getItem = () => { throw new Error("storage denied"); };
  game.localStorage.setItem = () => { throw new Error("storage denied"); };
  assert.equal(game.context.loadVerbTargetTextPreferences().colorTones, true);
  game.click(game.guide);
  assert.equal(game.card("return").querySelector(".caatuu-target-text-notation"), null);
});

test("reading controls ignore consumed and inactive clicks but accept nested native button activation", () => {
  const game = harness();
  game.click(game.tones, { defaultPrevented: true });
  game.state.activeView = "home";
  game.click(game.tones);
  game.state.activeView = "verbs";
  game.state.trainTab = "word-net";
  game.click(game.tones);
  game.state.trainTab = "verb-lab";
  game.document.visibilityState = "hidden";
  game.click(game.tones);
  game.document.visibilityState = "visible";
  game.controls.setAttribute("hidden", "");
  game.click(game.tones);
  game.controls.removeAttribute("hidden");
  assert.equal(game.state.verbTargetTextPreferences.colorTones, true);
  assert.equal(game.localStorage.length, 0);
  const decoration = game.document.createElement("i");
  game.tones.append(decoration);
  game.state.verbSolutionRevealed = true;
  game.click(decoration);
  assert.equal(game.state.verbTargetTextPreferences.colorTones, false);
  assert.equal(game.calls.arrows, 1, "solution arrows are remeasured when card height changes");
  assert.equal(game.calls.choose, 0);
});
