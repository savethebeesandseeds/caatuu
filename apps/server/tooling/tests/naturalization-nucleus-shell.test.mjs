import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import * as contentProgression from "../../../language-runtime/static/source/games/content-progression.mjs";
import * as adaptivePractice from "../../../language-runtime/static/source/games/adaptive-practice.mjs";
import { createBrowserHarness } from "../../../language-runtime/tests/helpers/fake-browser.mjs";
import { mountRobotLoadingScreen } from "../../../language-runtime/static/source/games/embedded-game-controls.mjs";
import { afterInteractionPaint, createReviewContinuation } from "../../../language-runtime/static/source/games/practice-pacing.mjs";
import { createArabicReadingGuide } from "../../../language-runtime/static/source/arabic-reading-guide.mjs";
import { projectMandarinNucleusContexts } from "../../../../tools/language-content/project-mandarin-nucleus-contexts.mjs";

const repoRoot = new URL("../../../../", import.meta.url);
const NUCLEUS_SCHEMA_URL = "https://caatuu.org/schemas/development/naturalization-nucleus.preview.v1.json";
const readText = (path) => readFile(new URL(path, repoRoot), "utf8");
const readJson = (path) => readText(path).then(JSON.parse);

const [
  appEntry,
  bootstrap,
  controller,
  stylesheet,
  catalog,
  mandarinSetup,
  czechSetup,
  androidAssets,
  appAssets,
  readingGuides,
  shipFiles
] = await Promise.all([
  readText("apps/language-runtime/static/app/index.html"),
  readText("apps/language-runtime/static/source/app-bootstrap.mjs"),
  readText("apps/language-runtime/static/source/games/naturalization-nucleus/naturalization-nucleus.js"),
  readText("apps/language-runtime/static/source/games/naturalization-nucleus/naturalization-nucleus.css"),
  readJson("apps/languages/mandarin-simplified/static/data/games/naturalization-nucleus/content.json"),
  readJson("apps/languages/mandarin-simplified/static/setup-assets.json"),
  readJson("apps/languages/czech/static/setup-assets.json"),
  readJson("apps/languages/mandarin-simplified/android-assets.json"),
  readJson("apps/language-runtime/app-assets.json"),
  readJson("apps/languages/mandarin-simplified/static/data/games/word-world/reading-guides.json"),
  readdir(new URL("apps/launcher/static/assets/ships/", repoRoot))
]);

const context = vm.createContext({ window: {} });
vm.runInContext(controller, context, { filename: "naturalization-nucleus.js" });
const game = context.window.CaatuuNaturalizationNucleus;
const validatedCatalog = game.validateCatalog(catalog);
const arabicCatalog = await readJson("apps/languages/arabic-standard/static/data/games/naturalization-nucleus/content.json");

test("Arabic uses authored whole-word readings with exact vocabulary provenance", async () => {
  const pack = game.validateCatalog(arabicCatalog);
  const verbs = await readJson("apps/languages/arabic-standard/static/data/games/verb-nebula/content.json");
  for (const item of pack.challenges) {
    const source = verbs.find(verb => verb.id === item.sourceItemIds[0]);
    assert.equal(item.target, source.target.normalize("NFC"));
    assert.equal(item.englishAuditText, source.englishAuditText);
    assert.equal(item.difficulty, source.difficulty);
    assert.ok(!Object.hasOwn(item, "tone"));
    assert.ok(!Object.hasOwn(item, "hanzi"));
  }
  assert.equal(pack.challenges.find(item => item.target === "كَانَ").reading, "kāna");
  assert.equal(pack.challenges.find(item => item.target === "جَاءَ").reading, "jāʾa");
  assert.equal(pack.challenges.find(item => item.target === "فَعَلَ").reading, "faʿala");
  for (const difficulty of [0, 1, 2, 3]) for (const count of [5, 9]) {
    const round = game.createRound(pack, count, () => 0.4, "", difficulty);
    assert.equal(round.pieces.length, count);
    assert.ok(round.pieces.every(piece => piece.left.difficulty === difficulty));
    assert.equal(new Set(round.pieces.map(piece => game.readingKey(piece.left))).size, count);
  }
  for (const change of [
    pack => { delete pack.challenges[0].reading; },
    pack => { pack.challenges[0].target = "كان"; },
    pack => { pack.challenges[0].target = "َ"; },
    pack => { pack.challenges[0].reading = "---"; },
    pack => { pack.challenges[0].tone = 1; },
    pack => { pack.challenges[0].reading = "كَانَ"; },
    pack => { pack.notation.system = "pinyin"; },
    pack => { pack.courseId = "zh"; }
  ]) {
    const invalid = structuredClone(arabicCatalog);
    change(invalid);
    assert.throws(() => game.validateCatalog(invalid));
  }
});

test("Arabic matches both directions, isolates RTL words, speaks Arabic, and records reading evidence", async () => {
  const fixture = createLoadingHarness({ fetchImpl: async () => ({ ok: true, json: async () => arabicCatalog }) });
  const events = [], spoken = [];
  fixture.window.CaatuuCourse = { id: "ar", targetLanguage: { id: "ar" } };
  fixture.window.CaatuuLearning = { difficulty: () => 1, contentHistory: () => ({}),
    recordExposure: (gameId, event) => events.push({gameId, ...event}) };
  fixture.window.CaatuuChrome = { speakText: async text => spoken.push(text) };
  await fixture.api.mount();
  await fixture.advance(1600);
  assert.equal(fixture.element("NotationHelp").hidden, false);
  assert.match(fixture.element("NotationHelp").textContent, /ā, ī, ū/u);
  const tile = fixture.element("Deck").querySelector("button[data-naturalization-piece-id]");
  assert.equal(tile.querySelector("span").lang, "ar");
  assert.equal(tile.querySelector("span").dir, "rtl");
  tile.click();
  assert.ok(fixture.element("FeedbackPinyin").textContent);
  assert.ok(tile.querySelector("rt"));
  assert.equal(fixture.element("FeedbackHanzi").dir, "rtl");
  fixture.element("Deck").querySelector("button[data-naturalization-piece-id]").click();
  solveBoard(fixture);
  await settle();
  assert.equal(fixture.element("FeedbackPinyin").lang, "ar-Latn");
  assert.equal(fixture.element("FeedbackPinyin").dir, "ltr");
  assert.ok(!Object.hasOwn(fixture.element("FeedbackReading").dataset, "tone"));
  assert.ok(spoken.every(text => arabicCatalog.challenges.some(item => item.target === text)));
  fixture.element("Continue").click();
  await fixture.advance(10000);
  assert.ok(events.some(event => event.bankId === "recognize-target-reading"));
  assert.ok(events.filter(event => event.bankId === "recognize-target-reading").every(event => event.evidence === "assisted"));
  const reverseTile = fixture.element("Deck").querySelector("button[data-naturalization-piece-id]");
  assert.equal(reverseTile.querySelector("span").lang, "ar-Latn");
  assert.equal(reverseTile.querySelector("span").dir, "ltr");
  reverseTile.click();
  assert.equal(fixture.element("FeedbackHanzi").lang, "ar-Latn");
  assert.equal(fixture.element("FeedbackPinyin").textContent, "");
  fixture.element("Deck").querySelector("button[data-naturalization-piece-id]").click();
  solveBoard(fixture);
  fixture.element("Continue").click();
  await fixture.advance(10000);
  assert.ok(events.some(event => event.bankId === "recognize-reading-target"));
  fixture.window.dispatchEvent({ type: "pagehide", persisted: false });
});

test("Arabic Nucleus reading aid can be disabled in place and stays off across rounds", async () => {
  const fixture = createLoadingHarness({ fetchImpl: async () => ({ ok: true, json: async () => arabicCatalog }) });
  fixture.window.CaatuuCourse = { id: "ar", targetLanguage: { id: "ar" } };
  const events = [];
  fixture.window.CaatuuLearning = { difficulty: () => 1, contentHistory: () => ({}),
    recordExposure: (_gameId, event) => events.push(event) };
  await fixture.api.mount();
  await fixture.advance(1600);
  const tile = fixture.element("Deck").querySelector("button[data-naturalization-piece-id]");
  const id = tile.dataset.naturalizationPieceId;
  const setting = fixture.element("DisplayMenu").querySelector("[data-arabic-romanization-setting]");
  assert.equal(setting.getAttribute("aria-checked"), "true");
  setting.click();
  assert.equal(setting.getAttribute("aria-checked"), "false");
  assert.equal(fixture.element("Deck").querySelector("button[data-naturalization-piece-id]"), tile);
  assert.equal(tile.dataset.naturalizationPieceId, id);
  assert.equal(tile.querySelector("rt"), null);
  tile.click();
  assert.equal(fixture.element("FeedbackPinyin").hidden, true);
  assert.equal(fixture.window.localStorage.getItem("caatuu.ar.naturalization-nucleus.romanization"), "false");
  fixture.element("Deck").querySelector("button[data-naturalization-piece-id]").click();
  solveBoard(fixture);
  fixture.element("Continue").click();
  await fixture.advance(10000);
  assert.equal(fixture.element("Ring").querySelector("rt"), null);
  assert.equal(setting.getAttribute("aria-checked"), "false");
  solveBoard(fixture);
  fixture.element("Continue").click();
  await fixture.advance(10000);
  const assessments = events.filter(event => event.bankId);
  assert.ok(assessments.filter(event => event.bankId === "recognize-target-reading").every(event => event.evidence === "assisted"));
  const unaided = assessments.filter(event => event.bankId === "recognize-reading-target");
  assert.equal(unaided.length, 5);
  assert.ok(unaided.every(event => event.evidence === "independent"));
  fixture.window.dispatchEvent({ type: "pagehide", persisted: false });
});

async function settle() {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
}

function createLoadingHarness({ fetchImpl = async () => ({ ok: true, json: async () => catalog }),
  loadingModule = { mountRobotLoadingScreen } } = {}) {
  let now = 0;
  let timerId = 0;
  const timers = new Map();
  const observers = [];
  const fetchCalls = [];
  const harness = createBrowserHarness({ window: {
    CaatuuPracticePacing: { afterInteractionPaint, createReviewContinuation },
    Math,
    performance: { now: () => now },
    setTimeout(callback, delay) {
      const timer = { id: ++timerId, due: now + delay, callback };
      timers.set(timer.id, timer);
      return timer.id;
    },
    clearTimeout(id) { timers.delete(id); },
    MutationObserver: class {
      constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
      observe() {}
      disconnect() { this.disconnected = true; }
    },
    fetch: async (url, options) => { fetchCalls.push(url); return fetchImpl(url, options); }
  } });
  const start = appEntry.indexOf('<section class="train-tab-panel naturalization-nucleus-panel"');
  assert.ok(start >= 0);
  const stack = [harness.document.body];
  const voidTags = new Set(["img", "input", "br", "hr"]);
  for (const token of appEntry.slice(start).match(/<!--[^]*?-->|<[^>]+>|[^<]+/gu)) {
    if (token.startsWith("<!--")) continue;
    if (token.startsWith("</")) { stack.pop(); if (stack.length === 1) break; continue; }
    if (!token.startsWith("<")) { stack.at(-1).append(token); continue; }
    const [, tag, attributes] = /^<([\w-]+)\b([^]*)>$/u.exec(token);
    const node = harness.document.createElement(tag);
    for (const [, name, value] of attributes.matchAll(/([:\w-]+)(?:="([^"]*)")?/gu)) node.setAttribute(name, value ?? "");
    stack.at(-1).append(node);
    if (!voidTags.has(tag) && !token.endsWith("/>")) stack.push(node);
  }
  const element = (name) => harness.document.getElementById(`naturalizationNucleus${name}`);
  element("Artwork").complete = true;
  element("Artwork").naturalWidth = 100;
  const panel = harness.document.getElementById("trainPanelNaturalizationNucleus");
  panel.hidden = false;
  harness.document.querySelectorAll = (selector) => harness.registry.querySelectorAll(selector).filter((node) => node.isConnected);
  harness.document.querySelector = (selector) => harness.document.querySelectorAll(selector)[0] || null;
  harness.context.nucleusLoadingModule = loadingModule;
  harness.context.nucleusProgressionModule = adaptivePractice;
  harness.context.nucleusReadingModule = { createArabicReadingGuide };
  vm.runInContext(controller.replace(/import\("\/language-runtime\/static\/source\/games\/embedded-game-controls\.mjs\?v=[^"]+"\)/u,
    "Promise.resolve(nucleusLoadingModule)").replace(/import\("\/language-runtime\/static\/source\/games\/adaptive-practice\.mjs"\)/u,
    "Promise.resolve(nucleusProgressionModule)").replace(/import\("\/language-runtime\/static\/source\/arabic-reading-guide\.mjs\?v=[^"]+"\)/u,
    "Promise.resolve(nucleusReadingModule)"), harness.context);
  async function advance(milliseconds) {
    const until = now + milliseconds;
    let runs = 0;
    while ([...timers.values()].some((timer) => timer.due <= until)) {
      assert.ok(++runs < 100, "round timers must not loop without advancing time");
      const timer = [...timers.values()].sort((left, right) => left.due - right.due)[0];
      timers.delete(timer.id);
      now = timer.due;
      timer.callback();
      await settle();
    }
    now = until;
    await settle();
  }
  return { ...harness, element, panel, timers, advance, fetchCalls, observers,
    api: harness.window.CaatuuNaturalizationNucleus,
    syncPanelVisibility() { observers.filter((observer) => !observer.disconnected).forEach((observer) => observer.callback()); } };
}

function solveBoard(fixture) {
  const tiles = () => fixture.element("Deck").querySelectorAll("button[data-naturalization-piece-id]");
  const count = tiles().length;
  assert.ok(count > 0);
  for (let index = 0; index < count; index += 1) {
    const tile = tiles()[0], id = tile.dataset.naturalizationPieceId.split("--")[0];
    tile.click();
    fixture.element("Ring").querySelector(`[data-naturalization-challenge-id="${id}"]`).click();
  }
  assert.equal(tiles().length, 0);
}

for (const courseCatalog of [catalog, arabicCatalog]) for (const count of courseCatalog.roundSettings.pieceCounts) {
  test(`${courseCatalog.courseId} level zero completes both reading directions with the normal ${count}-tile controls`, async () => {
    const fixture = createLoadingHarness({ fetchImpl: async () => ({ ok: true, json: async () => courseCatalog }) });
    const assessments = [];
    let difficulty = 0;
    fixture.window.CaatuuCourse = { id: courseCatalog.courseId, targetLanguage: { id: courseCatalog.courseId } };
    fixture.window.CaatuuLearning = { difficulty: () => difficulty, contentHistory: () => ({}),
      recordExposure: (_gameId, event) => { if (event.bankId) assessments.push(event); } };
    await fixture.api.mount();
    await fixture.advance(1600);
    const controls = fixture.panel.querySelectorAll("[data-naturalization-piece-count]");
    assert.ok(controls.every(button => !button.disabled), "content difficulty does not disable tile settings");
    fixture.element("OptionsToggle").click();
    fixture.panel.querySelector(`[data-naturalization-piece-count="${count}"]`).click();
    await fixture.advance(1600);
    for (let direction = 0; direction < 2; direction += 1) {
      const board = fixture.element("Board"), deck = fixture.element("Deck"), ring = fixture.element("Ring");
      assert.equal(board.dataset.pieceCount, String(count));
      assert.equal(board.dataset.difficulty, "0");
      const tiles = deck.querySelectorAll("button[data-naturalization-piece-id]");
      const sockets = ring.querySelectorAll("[data-naturalization-socket-index]");
      assert.equal(tiles.length, count);
      assert.equal(sockets.length, count);
      const angles = sockets.map((_socket, index) => {
        const selector = `[data-piece-count="${count}"] .naturalization-nucleus-socket:nth-child(${index + 1})`;
        const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
        const match = new RegExp(`${escaped}[^{}]*\\{\\s*--angle: (-?\\d+)deg;`, "u").exec(stylesheet);
        assert.ok(match, "every socket has an authored visible orbit position");
        return Number(match[1]);
      });
      assert.equal(new Set(angles).size, count, "socket hit targets cannot overlap at a default angle");
      const first = tiles[0];
      first.click();
      first.dispatchEvent({ type: "keydown", key: "ArrowRight", bubbles: true });
      assert.equal(fixture.document.activeElement, tiles[1]);
      first.dispatchEvent({ type: "keydown", key: "Escape", bubbles: true, isComposing: true });
      assert.equal(first.getAttribute("aria-pressed"), "true");
      first.dispatchEvent({ type: "keydown", key: "Escape", bubbles: true });
      assert.equal(first.getAttribute("aria-pressed"), "false");
      const firstId = first.dataset.naturalizationPieceId.split("--")[0];
      first.click();
      sockets.find(socket => socket.dataset.naturalizationChallengeId !== firstId).click();
      assert.equal(assessments.filter(event => event.correct === false).length, direction + 1);
      assert.equal(deck.querySelectorAll("button[data-naturalization-piece-id]").length, count,
        "a wrong answer cannot consume a tile or finish the board");
      first.click();
      for (let index = 0; index < count; index += 1) {
        const tile = deck.querySelectorAll("button[data-naturalization-piece-id]")[0];
        const id = tile.dataset.naturalizationPieceId.split("--")[0];
        assert.equal(courseCatalog.challenges.find(challenge => challenge.id === id).difficulty, 0);
        const socket = ring.querySelector(`[data-naturalization-challenge-id="${id}"]`);
        if (index % 2) { socket.click(); tile.click(); }
        else { tile.click(); socket.click(); }
        assert.equal(deck.querySelectorAll("button[data-naturalization-piece-id]").length, count - index - 1);
      }
      assert.equal(board.dataset.solved, "true");
      assert.equal(fixture.element("Continue").hidden, false);
      assert.equal(assessments.filter(event => event.correct === true).length, count * (direction + 1));
      fixture.element("Continue").click();
      await fixture.advance(1600);
    }
    assert.equal(new Set(assessments.map(event => event.bankId)).size, 2, "both reading directions remain in the game");
    for (const nextDifficulty of [1, 0]) {
      difficulty = nextDifficulty;
      fixture.window.dispatchEvent({ type: "caatuu:learning-change", detail: { reason: "difficulty" } });
      await fixture.advance(1600);
      assert.equal(fixture.element("Board").dataset.pieceCount, String(count), "changing badges preserves the tile setting");
      assert.equal(fixture.element("Board").dataset.difficulty, String(difficulty));
      solveBoard(fixture);
    }
    fixture.window.dispatchEvent({ type: "pagehide", persisted: false });
  });
}

test("Campaign Nucleus reports one completion and waits for the shell to prepare its next board", async () => {
  const fixture = createLoadingHarness();
  const messages = [];
  fixture.document.body.dataset.campaignActive = "true";
  fixture.window.postMessage = (message, origin) => messages.push({ message, origin });
  await fixture.api.mount();
  await fixture.advance(1600);
  assert.equal(fixture.api.advanceCampaignRound(), false, "an unfinished board cannot advance");
  solveBoard(fixture);
  assert.equal(messages.length, 0, "the solved board remains visible before the completion signal");
  await fixture.advance(10000);
  assert.equal(messages.length, 0, "time alone cannot complete the review");
  fixture.element("Continue").click();
  fixture.element("Continue").click();
  assert.equal(messages.length, 1);
  assert.equal(messages[0].message.gameId, "naturalization-nucleus");
  assert.equal(messages[0].message.type, "round-success");
  assert.equal(messages[0].message.source, "caatuu-game");
  assert.equal(messages[0].origin, fixture.window.location.origin);
  assert.equal(fixture.element("Deck").querySelectorAll("button[data-naturalization-piece-id]").length, 0);
  assert.equal(fixture.api.advanceCampaignRound(), true);
  assert.equal(fixture.api.advanceCampaignRound(), false, "duplicate advances do not replace a fresh round");
  await fixture.advance(1600);
  solveBoard(fixture);
  fixture.element("Continue").click();
  await fixture.advance(10000);
  assert.equal(messages.length, 2, "the next visit also completes");
  fixture.window.dispatchEvent({ type: "pagehide", persisted: false });
});

test("leaving Campaign resumes standalone Nucleus instead of stranding a completed board", async () => {
  for (const leaveAfterSignal of [false, true]) {
    const fixture = createLoadingHarness();
    fixture.document.body.dataset.campaignActive = "true";
    fixture.window.postMessage = () => {};
    await fixture.api.mount();
    await fixture.advance(1600);
    solveBoard(fixture);
    if (leaveAfterSignal) fixture.element("Continue").click();
    fixture.panel.hidden = true;
    fixture.syncPanelVisibility();
    delete fixture.document.body.dataset.campaignActive;
    fixture.panel.hidden = false;
    fixture.syncPanelVisibility();
    if (!leaveAfterSignal) fixture.element("Continue").click();
    await fixture.advance(1600);
    assert.ok(fixture.element("Deck").querySelectorAll("button[data-naturalization-piece-id]").length > 0);
    fixture.window.dispatchEvent({ type: "pagehide", persisted: false });
  }
});

test("Nucleus records each practiced character only after the board is completed", async () => {
  const fixture = createLoadingHarness();
  const exposures=[];
  const common=[];
  const banks=[];
  let generation = "before-reset";
  fixture.window.CaatuuLearning={difficulty:()=>1,contentHistory:(_game,bank)=>{banks.push(bank);return {};},contentGeneration:()=>generation,
    recordExposure:(gameId,event)=>(event.bankId?exposures:common).push({gameId,...event})};
  await fixture.api.mount();
  await fixture.advance(1600);
  const tiles=()=>fixture.element("Deck").querySelectorAll("button[data-naturalization-piece-id]");
  const count=tiles().length;
  generation = "after-reset";
  assert.equal(exposures.length,0);
  for(let index=0;index<count;index+=1){
    const tile=tiles()[0];
    const id=tile.dataset.naturalizationPieceId.split("--")[0];
    tile.click();
    fixture.element("Ring").querySelector(`[data-naturalization-challenge-id="${id}"]`).click();
    if(index<count-1)assert.equal(exposures.length,0);
  }
  assert.equal(exposures.length,count);
  assert.equal(new Set(exposures.map(event=>event.itemId)).size,count);
  assert.equal(new Set(exposures.map(event=>event.encounterId)).size,1);
  assert.ok(exposures.every(event=>event.correct===true));
  assert.ok(exposures.every(event=>event.generation==="before-reset"));
  assert.ok(exposures.every(event=>event.evidence==="independent"));
  assert.ok(exposures.every(event=>event.bankId==="recognize-hanzi-pinyin"));
  assert.equal(common.length,count);
  assert.ok(common.every(event=>event.evidence==="exposure" && event.correct===null));
  fixture.element("Continue").click();
  await fixture.advance(10000);
  assert.ok(banks.includes("recognize-pinyin-hanzi"),"the reversed board reads its own recognition evidence");
  for(let index=0;index<count;index+=1){
    const tile=tiles()[0],id=tile.dataset.naturalizationPieceId.split("--")[0];
    tile.click(); fixture.element("Ring").querySelector(`[data-naturalization-challenge-id="${id}"]`).click();
  }
  assert.ok(exposures.slice(count).every(event=>event.bankId==="recognize-pinyin-hanzi"));
  fixture.window.dispatchEvent({type:"pagehide",persisted:false});
});

test("Nucleus assesses spacing against common exposure captured before the current result", async () => {
  const fixture = createLoadingHarness();
  const common = {};
  const directional = {};
  const results = [];
  const recentExposure = "2026-09-11T09:55:00Z";
  const currentExposure = "2026-09-11T10:00:00Z";
  fixture.window.CaatuuLearning = { difficulty: () => 1, contentGeneration: () => "fixture-generation",
    contentHistory: (_game, bank) => bank ? directional : common,
    recordExposure: (_game, event) => {
      if (event.bankId) results.push(event);
      else common[event.itemId] = { lastSeenAt: currentExposure };
    } };
  await fixture.api.mount();
  await fixture.advance(1600);
  const tiles = () => fixture.element("Deck").querySelectorAll("button[data-naturalization-piece-id]");
  const ids = tiles().map(tile => tile.dataset.naturalizationPieceId.split("--")[0]);
  const unseenId = ids.at(-1);
  for (const id of ids) {
    if (id !== unseenId) common[id] = { lastSeenAt: recentExposure };
    directional[id] = { lastSeenAt: "2026-09-01T10:00:00Z" };
  }
  for (const id of ids) {
    tiles().find(tile => tile.dataset.naturalizationPieceId.split("--")[0] === id).click();
    fixture.element("Ring").querySelector(`[data-naturalization-challenge-id="${id}"]`).click();
  }
  assert.equal(results.length, ids.length);
  for (const event of results) {
    assert.equal(event.previousExposureAt, event.itemId === unseenId ? undefined : recentExposure);
    assert.equal(common[event.itemId].lastSeenAt, currentExposure, "the common event was already recorded");
    assert.equal(event.evidence, "independent", "recent exposure constrains spacing without relabeling the response");
    assert.equal(event.correct, true);
  }
  fixture.window.dispatchEvent({ type: "pagehide", persisted: false });
});

test("Nucleus shares daily exposure for exploration while retaining direction-specific evidence", async () => {
  const fixture = createLoadingHarness();
  const [first, second] = validatedCatalog.challenges;
  const common = Object.fromEntries([first, second].map(item => [item.id, {
    exposures: 40, practiceDays: 9, lastPracticeDayAt: "2026-09-11T09:00:00Z",
    independentSuccesses: 20, independentDays: 20, spacedSuccesses: 19, intervalMs: 86400000 * 20
  }]));
  const directional = { [second.id]: { exposures: 2, practiceDays: 2,
    lastPracticeDayAt: "2026-09-10T09:00:00Z", independentSuccesses: 1 } };
  const histories = [];
  fixture.context.nucleusProgressionModule = { ...adaptivePractice, selectContentItems(items, options) {
    histories.push(options.history);
    return adaptivePractice.selectContentItems(items, options);
  } };
  fixture.window.CaatuuLearning = { difficulty: () => 1,
    contentHistory: (_game, bank) => bank ? directional : common,
    contentGeneration: () => "fixture-generation" };
  await fixture.api.mount();
  await fixture.advance(1600);
  assert.ok(histories.length);
  const history = histories[0];
  assert.equal(history[first.id].practiceDays, 9);
  assert.equal(history[first.id].lastPracticeDayAt, common[first.id].lastPracticeDayAt);
  assert.equal(history[first.id].independentSuccesses, undefined);
  assert.equal(history[first.id].spacedSuccesses, undefined);
  assert.equal(history[first.id].intervalMs, undefined);
  assert.equal(history[second.id].practiceDays, 2);
  assert.equal(history[second.id].lastPracticeDayAt, directional[second.id].lastPracticeDayAt);
  assert.equal(history[second.id].independentSuccesses, 1);
  fixture.window.dispatchEvent({ type: "pagehide", persisted: false });
});

test("homophone exclusion preserves scheduler priority and fills enough distinct readings",()=>{
  const first=validatedCatalog.challenges[0];
  const second={...first,id:"fixture.priority",usefulness:100,complexity:1};
  const lower={...first,id:"fixture.later",usefulness:1,complexity:100};
  const other=validatedCatalog.challenges.filter(item=>game.readingKey(item)!==game.readingKey(first));
  const synthetic={...validatedCatalog,challenges:[lower,second,...other]};
  for(const value of [0,.1,.37,.99]){
    const calls=[];
    const round=game.createRound(synthetic,5,()=>value,"",first.difficulty,{selectContentItems(items){
      calls.push(items);
      return items.includes(second) ? [second,lower] : items.slice(0,4);
    }});
    assert.ok(calls[0].includes(lower) && calls[0].includes(second), "all homophones reach the scheduler");
    assert.ok(calls.length>1, "additional unique readings fill an ambiguous first pool");
    assert.equal(round.solution[0].left.id,second.id);
    assert.equal(new Set(round.solution.map(piece=>game.readingKey(piece.left))).size,5);
  }
});

test("a due difficult homophone reaches the board ahead of its recently practiced easy peer", () => {
  const first = validatedCatalog.challenges[0];
  const easier = { ...first, id: "fixture.earlier", difficulty: 3, usefulness: 100, complexity: 1 };
  const harder = { ...first, id: "fixture.later", difficulty: 3, usefulness: 1, complexity: 100 };
  const other = validatedCatalog.challenges.filter(item => game.readingKey(item) !== game.readingKey(first));
  const synthetic = { ...validatedCatalog, challenges: [easier, harder, ...other] };
  const history = Object.fromEntries(synthetic.challenges.map(item => [item.id,
    { exposures: 10, independentSuccesses: 2, lastCorrect: true,
      dueAt: new Date(Date.now()+86400000).toISOString(), lastSeenAt: new Date().toISOString() }]));
  history[harder.id] = { exposures: 10, independentSuccesses: 2, lastCorrect: false,
    dueAt: new Date(Date.now()-86400000).toISOString(), lastSeenAt: new Date(Date.now()-172800000).toISOString() };
  const round = game.createRound(synthetic, 5, () => 0.2, "", 3, { ...contentProgression, history });
  assert.ok(round.solution.some(piece=>piece.left.id===harder.id));
  assert.ok(!round.solution.some(piece=>piece.left.id===easier.id));
});

test("Nucleus pronunciation before matching is assistance even after the clue closes", async () => {
  const fixture = createLoadingHarness();
  const exposures=[];
  fixture.window.CaatuuLearning={difficulty:()=>1,contentHistory:()=>({}),
    recordExposure:(gameId,event)=>{if(event.bankId)exposures.push(event);}};
  fixture.window.CaatuuChrome={speakText:()=>Promise.resolve()};
  await fixture.api.mount();
  await fixture.advance(1600);
  const tiles=()=>fixture.element("Deck").querySelectorAll("button[data-naturalization-piece-id]");
  const hinted=tiles()[0].dataset.naturalizationPieceId.split("--")[0];
  tiles()[0].click();
  fixture.element("FeedbackSound").click();
  tiles()[0].click();
  while(tiles().length){
    const tile=tiles()[0], id=tile.dataset.naturalizationPieceId.split("--")[0];
    tile.click();
    fixture.element("Ring").querySelector(`[data-naturalization-challenge-id="${id}"]`).click();
  }
  assert.equal(exposures.find(event=>event.itemId===hinted).evidence,"assisted");
  assert.ok(exposures.filter(event=>event.itemId!==hinted).every(event=>event.evidence==="independent"));
  fixture.window.dispatchEvent({type:"pagehide",persisted:false});
});

test("the static Nucleus robot follows visibility before its shared module resolves", async () => {
  let resolveModule;
  const loadingModule = new Promise((resolve) => { resolveModule = resolve; });
  const fixture = createLoadingHarness({ loadingModule });
  fixture.document.visibilityState = "hidden";
  const mounting = fixture.api.mount();
  assert.equal(fixture.element("Interstitial").dataset.active, "false", "initial visibility is applied synchronously");
  fixture.document.visibilityState = "visible";
  fixture.document.dispatchEvent({ type: "visibilitychange" });
  assert.equal(fixture.element("Interstitial").dataset.active, "true");
  fixture.panel.hidden = true;
  fixture.syncPanelVisibility();
  assert.equal(fixture.element("Interstitial").dataset.active, "false");
  fixture.panel.hidden = false;
  fixture.syncPanelVisibility();
  assert.equal(fixture.element("Interstitial").dataset.active, "true");
  fixture.window.dispatchEvent({ type: "pagehide", persisted: true });
  assert.equal(fixture.element("Interstitial").dataset.active, "false");
  await fixture.advance(5000);
  assert.equal(fixture.fetchCalls.length, 0);
  assert.equal(fixture.timers.size, 0);
  fixture.window.dispatchEvent({ type: "pageshow", persisted: true });
  assert.equal(fixture.element("Interstitial").dataset.active, "true");
  resolveModule({ mountRobotLoadingScreen });
  await mounting;
  assert.equal(fixture.element("Interstitial").dataset.active, "true");
  await fixture.advance(1600);
  assert.equal(fixture.element("Interstitial").hidden, true);
  assert.equal(fixture.element("Deck").children.length, 5);
  fixture.window.dispatchEvent({ type: "pagehide", persisted: false });
});

test("retiring Nucleus before its shared module resolves hides the static robot and prevents catalog loading", async () => {
  let resolveModule;
  const loadingModule = new Promise((resolve) => { resolveModule = resolve; });
  const fixture = createLoadingHarness({ loadingModule });
  const mounting = fixture.api.mount();
  fixture.window.dispatchEvent({ type: "pagehide", persisted: false });
  assert.equal(fixture.element("Interstitial").hidden, true);
  assert.equal(fixture.element("Interstitial").dataset.active, "false");
  resolveModule({ mountRobotLoadingScreen });
  assert.equal(await mounting, null);
  assert.equal(fixture.fetchCalls.length, 0);
  assert.equal(fixture.timers.size, 0);
  assert.equal(fixture.element("Deck").children.length, 0);
  assert.ok(fixture.observers.every((observer) => observer.disconnected));
});

test("Nucleus loads only until its catalog and artwork are actually ready", async () => {
  let resolveContent;
  const content = new Promise(resolve => { resolveContent = resolve; });
  const fixture = createLoadingHarness({ fetchImpl: () => content });
  const mounting = fixture.api.mount();
  await settle();
  assert.equal(fixture.element("Interstitial").hidden, false);
  assert.equal(fixture.timers.size, 0);
  resolveContent({ ok: true, json: async () => catalog });
  await mounting;
  assert.equal(fixture.timers.size, 0, "ready artwork adds no artificial loading interval");
  assert.equal(fixture.element("Interstitial").hidden, true);
  assert.equal(fixture.element("Deck").children.length, 5);
  fixture.window.dispatchEvent({ type: "pagehide", persisted: false });
});

for (const reason of ["document", "panel", "page cache"]) {
  test(`Nucleus does not reveal decoded artwork or move focus while ${reason} is hidden`, async () => {
    const fixture = createLoadingHarness();
    fixture.element("Artwork").complete = false;
    await fixture.api.mount();
    const originalFocus = fixture.document.activeElement;
    if (reason === "document") {
      fixture.document.visibilityState = "hidden";
      fixture.document.dispatchEvent({ type: "visibilitychange" });
    } else if (reason === "panel") {
      fixture.panel.hidden = true; fixture.syncPanelVisibility();
    } else fixture.window.dispatchEvent({ type: "pagehide", persisted: true });
    fixture.element("Artwork").dispatchEvent({ type: "load" });
    await fixture.advance(10000);
    assert.equal(fixture.element("Interstitial").hidden, false);
    assert.equal(fixture.document.activeElement, originalFocus);
    if (reason === "document") {
      fixture.document.visibilityState = "visible";
      fixture.document.dispatchEvent({ type: "visibilitychange" });
    } else if (reason === "panel") {
      fixture.panel.hidden = false; fixture.syncPanelVisibility();
    } else fixture.window.dispatchEvent({ type: "pageshow", persisted: true });
    await fixture.advance(0);
    assert.equal(fixture.element("Interstitial").hidden, true);
    fixture.window.dispatchEvent({ type: "pagehide", persisted: false });
  });
}

for (const [toggle, menu] of [["DisplayToggle", "DisplayMenu"], ["Sound", "AudioMenu"], ["OptionsToggle", "OptionsMenu"]]) {
  test(`Nucleus completed-board Continue waits while ${menu} is open`, async () => {
    const fixture = createLoadingHarness();
    await fixture.api.mount();
    solveBoard(fixture);
    const button = fixture.element("Continue");
    fixture.element(toggle).click();
    assert.equal(button.disabled, true);
    button.click();
    await fixture.advance(60000);
    assert.equal(fixture.element("Deck").querySelectorAll("button[data-naturalization-piece-id]").length, 0);
    fixture.element(menu).dispatchEvent({ type: "keydown", key: "Escape" });
    assert.equal(button.disabled, false);
    await fixture.advance(60000);
    assert.equal(button.hidden, false, "closing a menu never releases review by itself");
    button.click(); button.click();
    assert.equal(fixture.element("Deck").querySelectorAll("button[data-naturalization-piece-id]").length, 5);
    assert.equal(button.hidden, true);
    fixture.window.dispatchEvent({ type: "pagehide", persisted: false });
  });
}

test("Nucleus review survives pronunciation and contextual replay until Continue, without repeating rewards", async () => {
  const fixture = createLoadingHarness();
  const speech = [], rewards = [];
  fixture.window.CaatuuChrome = { speakText: text => new Promise(resolve => { speech.push({ text, resolve }); }), stopSpeech() {} };
  fixture.window.CaatuuLearning = { record: (...args) => rewards.push(args) };
  await fixture.api.mount();
  solveBoard(fixture);
  const button = fixture.element("Continue");
  await fixture.advance(60000);
  speech.forEach(request => request.resolve()); await settle();
  fixture.element("Feedback").querySelector(".naturalization-nucleus-context-play").click();
  await fixture.advance(60000);
  assert.equal(button.hidden, false);
  assert.equal(button.disabled, false, "Continue can deliberately stop playback");
  button.click(); button.click();
  assert.equal(fixture.element("Deck").querySelectorAll("button[data-naturalization-piece-id]").length, 5);
  speech.at(-1).resolve(); await fixture.advance(60000);
  assert.equal(button.hidden, true, "obsolete speech cannot reopen a consumed review");
  assert.equal(rewards.length, 1);
  fixture.window.dispatchEvent({ type: "pagehide", persisted: false });
});

for (const speechFailure of [() => { throw new Error("voice unavailable"); }, () => Promise.reject(new Error("voice failed"))]) {
  test("Nucleus speech failure leaves review waiting for its Continue button", async () => {
    const fixture = createLoadingHarness();
    fixture.window.CaatuuChrome = { speakText: speechFailure };
    await fixture.api.mount(); solveBoard(fixture);
    await fixture.advance(60000);
    assert.equal(fixture.element("Continue").hidden, false);
    fixture.element("Continue").click();
    assert.equal(fixture.element("Deck").querySelectorAll("button[data-naturalization-piece-id]").length, 5);
    fixture.window.dispatchEvent({ type: "pagehide", persisted: false });
  });
}

test("reward pauses disable Nucleus Continue and never emit Campaign completion automatically", async () => {
  const fixture = createLoadingHarness();
  const messages = [];
  fixture.document.body.dataset.campaignActive = "true";
  fixture.window.postMessage = message => messages.push(message);
  const setPaused = value => {
    fixture.document.body.toggleAttribute("data-caatuu-practice-paused", value);
    fixture.window.dispatchEvent({ type: "caatuu:game-dynamics-change" });
  };
  await fixture.api.mount();
  fixture.window.CaatuuLearning = { record() { setPaused(true); } };
  solveBoard(fixture);
  fixture.element("Continue").click(); await fixture.advance(60000);
  assert.equal(messages.length, 0);
  setPaused(false); await fixture.advance(60000);
  assert.equal(messages.length, 0);
  fixture.element("Continue").click(); fixture.element("Continue").click();
  assert.equal(messages.length, 1);
  fixture.window.dispatchEvent({ type: "pagehide", persisted: false });
});

test("Nucleus cancels obsolete review on a settings reset and on final disposal", async () => {
  const fixture = createLoadingHarness();
  await fixture.api.mount(); solveBoard(fixture);
  const button = fixture.element("Continue");
  fixture.document.querySelector('[data-naturalization-piece-count="9"]').click();
  assert.equal(button.hidden, true);
  button.click();
  assert.equal(fixture.element("Deck").querySelectorAll("button[data-naturalization-piece-id]").length, 9);
  solveBoard(fixture);
  fixture.window.dispatchEvent({ type: "pagehide", persisted: false });
  button.click(); await fixture.advance(60000);
  assert.equal(button.hidden, true);
  assert.equal(fixture.timers.size, 0);
});

test("Nucleus wrong placement remains visible until the learner makes another selection", async () => {
  const fixture = createLoadingHarness();
  await fixture.api.mount();
  const tile = fixture.element("Deck").querySelector("button[data-naturalization-piece-id]");
  const id = tile.dataset.naturalizationPieceId.split("--")[0];
  tile.click();
  fixture.element("Ring").querySelectorAll("[data-naturalization-challenge-id]")
    .find(socket => socket.dataset.naturalizationChallengeId !== id).click();
  const feedback = fixture.element("Status").textContent;
  await fixture.advance(60000);
  assert.equal(fixture.element("Status").textContent, feedback);
  fixture.element("Deck").querySelector("button[data-naturalization-piece-id]").click();
  assert.notEqual(fixture.element("Status").textContent, feedback);
  fixture.window.dispatchEvent({ type: "pagehide", persisted: false });
});

test("subsequent Nucleus rounds load only unresolved artwork and destruction cancels its callbacks", async () => {
  const fixture = createLoadingHarness();
  await fixture.api.mount();
  fixture.element("Artwork").complete = false;
  fixture.document.querySelector('[data-naturalization-piece-count="9"]').click();
  assert.equal(fixture.element("Interstitial").hidden, false);
  const timer = [...fixture.timers.values()][0];
  fixture.window.dispatchEvent({ type: "pagehide", persisted: false });
  timer.callback(); await fixture.advance(10000);
  assert.equal(fixture.element("Interstitial").hidden, true);
  assert.equal(fixture.timers.size, 0);
  assert.ok(fixture.observers.every(observer => observer.disconnected));
});
test("retiring Nucleus during catalog loading discards the late result", async () => {
  let resolveContent;
  const content = new Promise((resolve) => { resolveContent = resolve; });
  const fixture = createLoadingHarness({ fetchImpl: () => content });
  const mounting = fixture.api.mount();
  await settle();
  fixture.window.dispatchEvent({ type: "pagehide", persisted: false });
  resolveContent({ ok: true, json: async () => catalog });
  assert.equal(await mounting, null);
  assert.equal(fixture.element("Interstitial").hidden, true);
  assert.equal(fixture.element("Deck").children.length, 0);
  assert.equal(fixture.timers.size, 0);
  assert.ok(fixture.observers.every((observer) => observer.disconnected));
});

test("Nucleus keeps its shared loader until artwork is decoded and cancels pending work on retirement", async () => {
  const fixture = createLoadingHarness();
  const artwork = fixture.element("Artwork");
  artwork.complete = false;
  let decode;
  artwork.decode = () => new Promise((resolve) => { decode = resolve; });
  await fixture.api.mount();
  await fixture.advance(1600);
  assert.equal(fixture.element("Interstitial").hidden, false);
  assert.equal(fixture.element("Game").hasAttribute("inert"), true);
  artwork.dispatchEvent({ type: "load" });
  await settle();
  assert.equal(fixture.element("Interstitial").hidden, false);
  decode();
  await settle();
  assert.equal(fixture.element("Interstitial").hidden, true);
  assert.equal(fixture.element("Status").parentElement.hidden, false);
  fixture.document.querySelector('[data-naturalization-piece-count="9"]').click();
  await fixture.advance(1600);
  fixture.window.dispatchEvent({ type: "pagehide", persisted: false });
  assert.equal(fixture.timers.size, 0);
  artwork.dispatchEvent({ type: "load" });
  await settle();
  assert.equal(fixture.element("Interstitial").hidden, true);
});

test("failed artwork cannot leave Nucleus stuck behind its loader", async () => {
  const fixture = createLoadingHarness();
  fixture.element("Artwork").complete = false;
  await fixture.api.mount();
  await fixture.advance(9600);
  assert.equal(fixture.element("Interstitial").hidden, true);
  assert.equal(fixture.element("Artwork").hidden, true);
  assert.equal(fixture.element("Game").getAttribute("aria-hidden"), "false");
  fixture.window.dispatchEvent({ type: "pagehide", persisted: false });
});

test("unfinished dictionary cards conceal the answer, then reveal both scripts after matching", async () => {
  const fixture = createLoadingHarness();
  await fixture.api.mount();
  await fixture.advance(1600);
  for (const script of ["hanzi", "pinyin"]) {
    const tile = fixture.element("Deck").querySelector("button");
    // Pinyin is not unique across the catalog: use the selected tile's identity.
    const challengeId = tile.dataset.naturalizationPieceId.split("--")[0];
    const challenge = catalog.challenges.find((entry) => entry.id === challengeId);
    assert.ok(challenge);
    assert.equal(tile.textContent, challenge[script]);
    tile.click();
    const feedback = fixture.element("Feedback");
    assert.equal(feedback.hidden, false);
    assert.equal(feedback.dataset.state, "preview");
    assert.equal(fixture.element("FeedbackMeaning").textContent, challenge.translation);
    assert.equal(fixture.element("FeedbackPinyin").textContent, "");
    assert.equal(fixture.element("FeedbackHanzi").getAttribute("aria-label"), challenge[script]);
    assert.equal(fixture.element("FeedbackSound").getAttribute("aria-label"), `Play isolated character ${challenge[script]}.`);
    assert.equal(fixture.element("FeedbackReading").hasAttribute("data-tone"), false);
    const otherScript = script === "hanzi" ? "pinyin" : "hanzi";
    fixture.element("Ring").querySelectorAll("button").find((button) => button.textContent === challenge[otherScript]).click();
    assert.equal(feedback.dataset.state, "matched");
    assert.equal(fixture.element("FeedbackPinyin").textContent, challenge.pinyin);
    assert.equal(fixture.element("FeedbackHanzi").getAttribute("aria-label"), `${challenge.hanzi}, ${challenge.pinyin}`);
    assert.equal(feedback.parentElement.parentElement.contains(fixture.element("Board")), true);
    assert.equal(fixture.element("Game").contains(fixture.element("Status")), false, "instructions sit below the game surface");
    fixture.document.querySelector('[data-naturalization-piece-count="9"]').click();
    await fixture.advance(1600);
  }
  fixture.window.dispatchEvent({ type: "pagehide", persisted: false });
});

test("dictionary previews disappear when a tile is deselected by click or Escape", async () => {
  const fixture = createLoadingHarness();
  await fixture.api.mount();
  await fixture.advance(1600);
  for (const script of ["hanzi", "pinyin"]) {
    const deck = fixture.element("Deck");
    const feedback = fixture.element("Feedback");
    deck.querySelector("button").click();
    assert.equal(feedback.hidden, false, script);
    deck.querySelector("button").click();
    assert.equal(feedback.hidden, true, "clicking the selected tile again dismisses its preview");
    deck.querySelector("button").click();
    deck.querySelector("button").dispatchEvent({ type: "keydown", key: "Escape", bubbles: true });
    assert.equal(feedback.hidden, true, "Escape dismisses the preview");
    fixture.document.querySelector('[data-naturalization-piece-count="9"]').click();
    await fixture.advance(1600);
  }
  fixture.window.dispatchEvent({ type: "pagehide", persisted: false });
});

test("Nucleus rejects hidden board input and cancels a drag when leaving, blurring or opening settings", async () => {
  const fixture = createLoadingHarness();
  await fixture.api.mount();
  await fixture.advance(1600);
  const tiles = () => fixture.element("Deck").querySelectorAll("button[data-naturalization-piece-id]");
  const originalCount = tiles().length;
  const tile = tiles()[0];
  const id = tile.dataset.naturalizationPieceId.split("--")[0];
  const socket = () => fixture.element("Ring").querySelector(`[data-naturalization-challenge-id="${id}"]`);
  const drag = () => tile.dispatchEvent({ type: "dragstart", bubbles: true });
  const drop = () => socket().dispatchEvent({ type: "drop", bubbles: true });
  fixture.panel.hidden = true;
  tile.click();
  socket().click();
  const rejected = { type: "dragstart", bubbles: true };
  tile.dispatchEvent(rejected);
  assert.equal(rejected.defaultPrevented, true);
  assert.equal(fixture.element("Feedback").hidden, true);
  fixture.panel.hidden = false;
  for (const cancel of [
    () => { fixture.panel.hidden = true; fixture.syncPanelVisibility(); fixture.panel.hidden = false; fixture.syncPanelVisibility(); },
    () => fixture.window.dispatchEvent({ type: "blur" }),
    () => { fixture.element("OptionsToggle").click(); fixture.element("OptionsToggle").click(); }
  ]) {
    drag(); cancel(); drop();
    assert.equal(tiles().length, originalCount, "a cancelled drag cannot place a tile later");
  }
  drag(); drop();
  assert.equal(tiles().length, originalCount - 1, "a fresh intentional drag still works");
  fixture.window.dispatchEvent({ type: "pagehide", persisted: false });
});

test("Nucleus consumes a drop's trailing click without selecting the next socket", async () => {
  const fixture = createLoadingHarness();
  await fixture.api.mount();
  await fixture.advance(1600);
  const tiles = () => fixture.element("Deck").querySelectorAll("button[data-naturalization-piece-id]");
  const first = tiles()[0], second = tiles()[1];
  const firstId = first.dataset.naturalizationPieceId.split("--")[0];
  const secondId = second.dataset.naturalizationPieceId.split("--")[0];
  const socket = (id) => fixture.element("Ring").querySelector(`[data-naturalization-challenge-id="${id}"]`);
  first.dispatchEvent({ type: "dragstart", bubbles: true });
  socket(firstId).dispatchEvent({ type: "drop", bubbles: true });
  const remaining = tiles().length;
  socket(secondId).click();
  await fixture.advance(0);
  fixture.element("Deck").querySelector(`[data-naturalization-piece-id="${second.dataset.naturalizationPieceId}"]`).click();
  assert.equal(tiles().length, remaining, "the trailing click must not preselect a socket for the next tile");
  socket(secondId).click();
  assert.equal(tiles().length, remaining - 1);
  fixture.window.dispatchEvent({ type: "pagehide", persisted: false });
});

test("Nucleus owns one wrong placement until a deliberate new selection permits retry", async () => {
  const fixture = createLoadingHarness();
  const exposures = [];
  let reenter;
  fixture.window.CaatuuLearning = { recordExposure: (_game, event) => {
    exposures.push(event);
    const callback = reenter;
    reenter = null;
    callback?.();
  } };
  await fixture.api.mount();
  await fixture.advance(1600);
  const tile = fixture.element("Deck").querySelector("button[data-naturalization-piece-id]");
  const id = tile.dataset.naturalizationPieceId.split("--")[0];
  tile.click();
  const wrongSocket = () => fixture.element("Ring").querySelectorAll("[data-naturalization-challenge-id]")
    .find((node) => node.dataset.naturalizationChallengeId !== id);
  reenter = () => wrongSocket().click();
  wrongSocket().click();
  wrongSocket().click();
  assert.equal(exposures.filter(({ correct }) => correct === false).length, 1);
  await fixture.advance(900);
  wrongSocket().click();
  assert.equal(exposures.filter(({ correct }) => correct === false).length, 1, "time never releases a repeated wrong placement");
  fixture.element("Deck").querySelector("button[data-naturalization-piece-id]").click();
  fixture.element("Deck").querySelector("button[data-naturalization-piece-id]").click();
  wrongSocket().click();
  assert.equal(exposures.filter(({ correct }) => correct === false).length, 2);
  fixture.window.dispatchEvent({ type: "pagehide", persisted: false });
});

test("Nucleus preserves selection during composition, modified keys and settings input", async () => {
  const fixture = createLoadingHarness();
  await fixture.api.mount();
  await fixture.advance(1600);
  const tile = () => fixture.element("Deck").querySelector("button[data-naturalization-piece-id]");
  tile().click();
  for (const property of ["defaultPrevented", "repeat", "isComposing", "altKey", "ctrlKey", "metaKey", "shiftKey"]) {
    tile().dispatchEvent({ type: "keydown", key: "Escape", bubbles: true, [property]: true });
    assert.equal(fixture.element("Feedback").hidden, false);
  }
  fixture.element("OptionsToggle").click();
  for (const ignored of [{ isComposing: true }, { keyCode: 229 }, { defaultPrevented: true }]) {
    fixture.element("OptionsMenu").dispatchEvent({ type: "keydown", key: "Escape", ...ignored });
    assert.equal(fixture.element("OptionsMenu").hidden, false);
  }
  tile().dispatchEvent({ type: "keydown", key: "Escape", bubbles: true });
  assert.equal(fixture.element("Feedback").hidden, false, "settings own input while open");
  fixture.element("OptionsToggle").click();
  for (const ignored of [{ isComposing: true }, { keyCode: 229 }, { defaultPrevented: true }]) {
    fixture.element("OptionsToggle").dispatchEvent({ type: "keydown", key: "ArrowDown", ...ignored });
    assert.equal(fixture.element("OptionsMenu").hidden, true);
  }
  fixture.element("OptionsToggle").dispatchEvent({ type: "keydown", key: "ArrowDown" });
  assert.equal(fixture.element("OptionsMenu").hidden, false);
  fixture.element("OptionsMenu").dispatchEvent({ type: "keydown", key: "Escape" });
  assert.equal(fixture.element("OptionsMenu").hidden, true);
  assert.equal(fixture.document.activeElement, fixture.element("OptionsToggle"));
  tile().dispatchEvent({ type: "keydown", key: "Escape", bubbles: true });
  assert.equal(fixture.element("Feedback").hidden, true);
  fixture.window.dispatchEvent({ type: "pagehide", persisted: false });
});

test("catalog failure dismisses the Nucleus loader and preserves the loading error", async () => {
  const fixture = createLoadingHarness({ fetchImpl: async () => ({ ok: false, status: 503 }) });
  await assert.rejects(fixture.api.mount(), /503/u);
  assert.equal(fixture.element("Interstitial").hidden, true);
  assert.equal(fixture.element("Status").dataset.state, "error");
  assert.equal(fixture.element("Status").textContent, "The domino puzzle could not be loaded.");
  assert.equal(fixture.element("Game").getAttribute("aria-hidden"), "false");
  assert.equal(fixture.timers.size, 0);
  assert.ok(fixture.observers.every((observer) => observer.disconnected));
});

test("each round swaps Hanzi and pinyin without exposing the answer on either side", () => {
  const rendering = vm.createContext({ window: {} });
  vm.runInContext(controller.replace("    mount,", "    roundPresentation, deckHanziTile, pinyinSocketTarget, mount,"), rendering);
  const view = rendering.window.CaatuuNaturalizationNucleus;
  const { document } = createBrowserHarness();
  const challenge = validatedCatalog.challenges[0];
  for (let index = 0; index < 4; index += 1) {
    const presentation = view.roundPresentation(index);
    assert.equal(presentation.deck, index % 2 ? "pinyin" : "hanzi");
    assert.equal(presentation.ring, index % 2 ? "hanzi" : "pinyin");
    const tile = view.deckHanziTile(document, { id: "test", left: challenge }, 0, false, false, false, presentation).children[0];
    const target = view.pinyinSocketTarget(document, 0, challenge, presentation);
    assert.equal(tile.textContent, challenge[presentation.deck]);
    assert.equal(target.textContent, challenge[presentation.ring]);
    assert.equal(tile.children[0].lang, index % 2 ? "zh-Latn-pinyin" : "zh-Hans");
    assert.ok(tile.getAttribute("aria-label").includes(presentation.deckLabel));
    assert.ok(target.getAttribute("aria-label").includes(presentation.ringLabel));
    assert.doesNotMatch(tile.children[0].className, /tone-/u);
  }
  assert.match(controller, /state\.roundIndex \+= 1/u);
});

test("deck tiles keep readable Hanzi, regular pinyin and quiet empty marks", () => {
  const hanziRule = stylesheet.match(/\.naturalization-nucleus-domino-hanzi\s*\{[^}]*font-weight:\s*(\d+);/u);
  const socketRule = stylesheet.match(/\.naturalization-nucleus-socket-pinyin\.naturalization-nucleus-script-hanzi\s*\{[^}]*font-weight:\s*(\d+);/u);
  assert.ok(Number(hanziRule?.[1]) >= 400 && Number(hanziRule?.[1]) <= 500);
  assert.ok(Number(socketRule?.[1]) >= 400 && Number(socketRule?.[1]) <= 500);
  assert.match(stylesheet, /background:\s*#edcf99/u);
  assert.match(stylesheet, /\.naturalization-nucleus-domino-hanzi\.naturalization-nucleus-script-pinyin\s*\{[^}]*font-weight:\s*400/u);
  assert.match(stylesheet, /\[data-state="placed"\]::after\s*\{\s*content:\s*"-"/u);
});

test("target-first selection waits without error and submits the same pair as tile-first", () => {
  const selectSource = controller.slice(controller.indexOf("    function selectPiece("), controller.indexOf("    function tryPlacement("));
  const ringSource = controller.slice(controller.indexOf('    listen(ring, "click",'), controller.indexOf('    listen(ring, "keydown",'));
  for (const targetFirst of [true, false]) {
    const state = { placements: [], selectedPieceId: "", selectedSocketIndex: -1 };
    const attempts = [];
    let errors = 0;
    let ringClick;
    const target = { dataset: { naturalizationSocketIndex: "2" } };
    const context = vm.createContext({
      state, transitioning: false, errorTimer: 0,
      global: { clearTimeout() {} }, cancelRoundTask() {},
      ring: { querySelector() { return { focus() {} }; } },
      listen(_target, _event, handler) { ringClick = handler; },
      eventSocketTarget() { return target; },
      pieceForId(id) { return { id }; }, solved() { return false; }, canUseBoard() { return true; }, render() {},
      tryPlacement(id, slot) { attempts.push([id, slot]); },
      rejectPlacement() { errors += 1; }
    });
    vm.runInContext(selectSource + ringSource, context);
    const clickTarget = () => ringClick({ target: { closest() { return null; } } });
    const clickTile = () => vm.runInContext('selectPiece("tile-a")', context);
    if (targetFirst) {
      clickTarget();
      assert.equal(errors, 0);
      assert.equal(state.selectedSocketIndex, 2);
      assert.deepEqual(attempts, []);
      clickTile();
    } else {
      clickTile();
      clickTarget();
    }
    assert.equal(errors, 0);
    assert.deepEqual(attempts, [["tile-a", 2]]);
  }
});

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

test("the course-owned controller exposes its engine boundary and stays CSP-safe", () => {
  assert.match(
    bootstrap,
    /const gameAvailable = \(gameId\) => \(\s*globalThis\.CaatuuShellPolicy\?\.gameAvailable\?\.\(course, gameId\) === true\s*\);/u
  );
  assert.match(bootstrap, /const naturalizationNucleus = gameAvailable\("naturalization-nucleus"\);/u);
  assert.match(bootstrap, /naturalization-nucleus\/naturalization-nucleus\.css\?v=naturalization-nucleus-\d+/u);
  assert.match(bootstrap, /naturalization-nucleus\/naturalization-nucleus\.js\?v=naturalization-nucleus-\d+/u);
  assert.match(controller, /CaatuuLearning\?\.record\?\.\("naturalization-nucleus"/u);
  assert.equal(typeof game.mount, "function");
  assert.equal(typeof game.createRound, "function");
  assert.equal(typeof game.filterChallengesForDifficulty, "function");
  assert.equal(typeof game.placeHanzi, "function");
  assert.equal(typeof game.countConnections, "function");
  assert.equal(typeof game.seedChain, "function");
  assert.equal(typeof game.attachPiece, "function");
  assert.equal(typeof game.describeChain, "function");
  assert.doesNotMatch(controller, /innerHTML/u);
  assert.doesNotMatch(controller, /\.style\b/u);
  assert.equal(typeof game.advanceCampaignRound, "function");
});

test("the static audio menu mounts the shared voice and music controls", () => {
  const fixture = createLoadingHarness();
  const menu = fixture.element("AudioMenu");
  assert.ok(menu.querySelector("[data-voice-controls]"));
  assert.ok(menu.querySelector("[data-music-controls]"));
  assert.equal(menu.getAttribute("role"), "dialog");
});

test("matched tiles stay flat in both themes and completed rounds provide explicit Continue", () => {
  for (const block of stylesheet.matchAll(/(?:html\[data-theme="dark"\] )?\.naturalization-nucleus-fused-word\s*\{([^}]+)\}/gu)) {
    assert.doesNotMatch(block[1], /gradient|background-image/u);
  }
  assert.doesNotMatch(appEntry, /naturalizationNucleusNewRound/u);
  assert.doesNotMatch(controller, /naturalizationNucleusNewRound|listen\(newRound/u);
  assert.match(controller, /createReviewContinuation/u);
});

test("word details follow the playable tiles so feedback cannot push the deck down", () => {
  const fixture = createLoadingHarness();
  const children = Array.from(fixture.element("Game").children);
  const deck = children.findIndex((node) => node.contains(fixture.element("Deck")));
  const feedback = children.findIndex((node) => node.contains(fixture.element("Feedback")));
  assert.ok(deck >= 0);
  assert.ok(feedback > deck);
});

for (const action of ["selection", "hide", "reset", "manual playback", "dispose"]) {
  test(`Nucleus discards deferred match audio after ${action}`, async () => {
    const fixture = createLoadingHarness();
    const spoken = [];
    fixture.window.CaatuuChrome = { speakText: async text => { spoken.push(text); } };
    await fixture.api.mount();
    const tiles = () => fixture.element("Deck").querySelectorAll("button[data-naturalization-piece-id]");
    const tile = tiles()[0], id = tile.dataset.naturalizationPieceId.split("--")[0];
    tile.click();
    fixture.element("Ring").querySelector(`[data-naturalization-challenge-id="${id}"]`).click();
    assert.equal(spoken.length, 0, "assignment renders before optional pronunciation starts");
    if (action === "selection") tiles()[0].click();
    else if (action === "hide") { fixture.panel.hidden = true; fixture.syncPanelVisibility(); }
    else if (action === "reset") fixture.panel.querySelector('[data-naturalization-piece-count="9"]').click();
    else if (action === "manual playback") fixture.element("FeedbackSound").click();
    else fixture.window.dispatchEvent({ type: "pagehide", persisted: false });
    await fixture.advance(0);
    assert.equal(spoken.length, action === "manual playback" ? 1 : 0,
      "an obsolete scheduled announcement cannot start or duplicate intentional playback");
    fixture.window.dispatchEvent({ type: "pagehide", persisted: false });
  });
}

for (const pieceCount of [5, 9]) {
  test(`Nucleus retains controls for rapid ${pieceCount}-tile matches while speech stays pending`, async () => {
    const fixture = createLoadingHarness();
    const speech = [];
    fixture.window.CaatuuChrome = { speakText: text => {
      speech.push(text);
      return new Promise(() => {});
    } };
    await fixture.api.mount();
    if (pieceCount !== 5) fixture.panel.querySelector(`[data-naturalization-piece-count="${pieceCount}"]`).click();
    const deck = fixture.element("Deck"), ring = fixture.element("Ring");
    const tiles = deck.querySelectorAll("button[data-naturalization-piece-id]");
    const sockets = tiles.map(tile => ring.querySelector(
      `[data-naturalization-challenge-id="${tile.dataset.naturalizationPieceId.split("--")[0]}"]`
    ));
    const firstId = tiles[0].dataset.naturalizationPieceId.split("--")[0];
    let firstMatch;
    for (let index = 0; index < tiles.length; index += 1) {
      const tile = tiles[index], socket = sockets[index];
      assert.equal(tile.isConnected, true, "unmatched tiles survive earlier assignments");
      assert.equal(socket.isConnected, true, "unmatched sockets survive earlier selections");
      if (index % 2) {
        socket.click();
        assert.equal(socket.getAttribute("aria-pressed"), "true");
        assert.equal(socket.isConnected, true, "socket selection preserves the active control");
        tile.click();
      } else {
        tile.click();
        assert.equal(tile.getAttribute("aria-pressed"), "true");
        assert.equal(tile.isConnected, true, "tile selection preserves the active control");
        socket.click();
      }
      assert.equal(deck.querySelectorAll("button[data-naturalization-piece-id]").length, pieceCount - index - 1,
        "each valid placement is visible in its click handler without advancing a clock");
      const firstReview = ring.querySelector(`[data-naturalization-review-id="${firstId}"]`);
      firstMatch ??= firstReview;
      assert.equal(firstReview, firstMatch, "completed matches are not reconstructed for later taps");
      assert.equal(speech.length, index, "visual placement precedes optional audio work");
      await fixture.advance(0);
    }
    assert.equal(fixture.element("Continue").hidden, false);
    assert.equal(speech.length, pieceCount, "pending speech never locks further matching");
    fixture.window.dispatchEvent({ type: "pagehide", persisted: false });
  });

  test(`a completed ${pieceCount}-tile board replaces the card area with Continue until the learner advances`, async () => {
    const fixture = createLoadingHarness();
    await fixture.api.mount();
    await fixture.advance(1600);
    if (pieceCount !== 5) {
      fixture.panel.querySelector(`[data-naturalization-piece-count="${pieceCount}"]`).click();
      await fixture.advance(1600);
    }
    const deck = fixture.element("Deck"), button = fixture.element("Continue");
    assert.equal(button.parentElement, deck.parentElement);
    assert.equal(deck.hidden, false);
    assert.equal(button.hidden, true);
    solveBoard(fixture);
    assert.equal(deck.hidden, true, "empty card wells give their space to Continue");
    assert.equal(button.hidden, false);
    assert.equal(button.parentElement, deck.parentElement, "rendering preserves Continue in the card panel");
    await fixture.advance(60000);
    assert.equal(fixture.element("Board").dataset.solved, "true");
    assert.equal(button.hidden, false, "review has no automatic continuation");
    button.click();
    await fixture.advance(1600);
    assert.equal(deck.hidden, false, "the next round restores the cards");
    assert.equal(deck.querySelectorAll("button[data-naturalization-piece-id]").length, pieceCount);
    assert.equal(button.hidden, true);
    fixture.window.dispatchEvent({ type: "pagehide", persisted: false });
  });
}

test("the matched-word dictionary card keeps intrinsic shared sizing", () => {
  assert.match(
    stylesheet,
    /\.word-net-word-translation\.naturalization-nucleus-feedback\s*\{\s*width:\s*fit-content;\s*max-width:\s*clamp\(140px,\s*30vw,\s*184px\);/u
  );
});

test("the catalog supplies every round size at each exact badge and uses available ship artwork", () => {
  assert.equal(catalog.$schema, NUCLEUS_SCHEMA_URL);
  assert.equal(validatedCatalog.$schema, NUCLEUS_SCHEMA_URL);
  assert.equal(catalog.schemaVersion, 1);
  assert.equal(catalog.courseId, "zh");
  assert.equal(catalog.gameId, "naturalization-nucleus");
  assert.equal(catalog.status, "machine-assisted-preview");
  assert.equal(catalog.review.status, "native-review-required");
  assert.deepEqual(catalog.roundSettings.pieceCounts, [5, 9]);
  assert.equal(catalog.roundSettings.defaultPieceCount, 5);
  assert.ok(catalog.challenges.length >= Math.max(...catalog.roundSettings.pieceCounts));
  assert.equal(new Set(catalog.challenges.map(({ id }) => id)).size, catalog.challenges.length);
  assert.equal(new Set(catalog.challenges.map(({ hanzi, difficulty }) => `${difficulty === 0 ? "zero:" : ""}${hanzi}`)).size, catalog.challenges.length);
  assert.ok(catalog.challenges.every(({ translation }) => typeof translation === "string" && translation.length > 0));
  assert.ok(catalog.challenges.every((challenge) => Object.hasOwn(challenge, "difficulty")));
  for (const difficulty of [0, 1, 2, 3]) {
    assert.ok(catalog.challenges.some(challenge => challenge.difficulty === difficulty));
    const eligible = game.filterChallengesForDifficulty(validatedCatalog.challenges, difficulty);
    assert.deepEqual(new Set(eligible.map(item => item.id)), new Set(catalog.challenges.filter(item => item.difficulty === difficulty).map(item => item.id)));
    assert.ok(new Set(eligible.map(game.readingKey)).size >= Math.max(...catalog.roundSettings.pieceCounts));
  }
  assert.ok(catalog.challenges.every(({ sourceConceptIds }) => (
    Array.isArray(sourceConceptIds)
    && sourceConceptIds.length > 0
    && new Set(sourceConceptIds).size === sourceConceptIds.length
  )));
  assert.ok(catalog.challenges.every(({ translation }) => (
    !/\b(?:weapon|gun|knife|blood|fight|attack|kill|war|violent)\b/iu.test(translation)
  )));

  const expectedShipFiles = shipFiles.filter((file) => file.endsWith(".png")).sort((left, right) => left.localeCompare(right, "en", { numeric: true }));
  const catalogShipFiles = catalog.roundSettings.artwork.map((src) => decodeURIComponent(src.split("/").at(-1))).sort((left, right) => left.localeCompare(right, "en", { numeric: true }));
  assert.ok(expectedShipFiles.length > 0);
  assert.equal(new Set(catalogShipFiles).size, catalogShipFiles.length);
  assert.ok(catalogShipFiles.every(file => expectedShipFiles.includes(file)), "every configured artwork file exists");
});

test("large content catalogs preserve validation, difficulty filtering and both round sizes", () => {
  // Synthetic capacity data only: these borrowed readings are not curriculum.
  const expanded = structuredClone(catalog);
  expanded.challenges = Array.from({ length: 4096 }, (_, index) => ({
    ...structuredClone(catalog.challenges[index % catalog.challenges.length]),
    id: `zh.hanzi.capacity-${index}`,
    hanzi: String.fromCodePoint(0x3400 + index)
  }));
  // The capacity fixture borrows readings but invents glyphs, so it has no
  // authored contextual example for those synthetic characters.
  expanded.challenges.forEach(challenge => { delete challenge.context; });
  const validated = game.validateCatalog(expanded);
  assert.equal(validated.challenges.length, expanded.challenges.length);
  assert.equal(validated.challenges.at(-1).id, expanded.challenges.at(-1).id);
  for (const difficulty of [0, 1, 2, 3]) {
    for (const pieceCount of catalog.roundSettings.pieceCounts) {
      const round = game.createRound(validated, pieceCount, seededRandom(difficulty * 100 + pieceCount), "", difficulty);
      assert.equal(round.pieces.length, pieceCount);
      assert.equal(game.countConnections(round.solution), pieceCount);
      assert.equal(new Set(round.solution.map(({ left }) => game.readingKey(left))).size, pieceCount);
      assert.ok(round.pieces.every(({ left, right }) => left.difficulty <= difficulty && right.difficulty <= difficulty));
    }
  }

  const malformedTail = structuredClone(expanded);
  malformedTail.challenges.at(-1).difficulty = 4;
  assert.throws(() => game.validateCatalog(malformedTail), /difficulty must be an integer/u);

  const duplicateId = structuredClone(expanded);
  duplicateId.challenges.at(-1).id = duplicateId.challenges[0].id;
  assert.throws(() => game.validateCatalog(duplicateId), /challenge ids must be unique/u);

  const duplicateCharacter = structuredClone(expanded);
  duplicateCharacter.challenges.at(-1).hanzi = duplicateCharacter.challenges[0].hanzi;
  assert.throws(() => game.validateCatalog(duplicateCharacter), /challenge Hanzi must be unique/u);

  const insufficient = structuredClone(catalog);
  insufficient.challenges = insufficient.challenges.slice(0, Math.max(...catalog.roundSettings.pieceCounts) - 1);
  assert.throws(() => game.validateCatalog(insufficient), /challenges must contain at least/u);
});

test("the catalog boundary requires explicit schema, difficulty, and honest review metadata", () => {
  const missingSchema = structuredClone(catalog);
  delete missingSchema.$schema;
  assert.throws(() => game.validateCatalog(missingSchema), /catalog root\.\$schema is required/u);

  const wrongSchema = structuredClone(catalog);
  wrongSchema.$schema = "https://example.invalid/nucleus.json";
  assert.throws(() => game.validateCatalog(wrongSchema), /catalog root\.\$schema must be https:\/\/caatuu\.org\/schemas\/development\/naturalization-nucleus\.preview\.v1\.json/u);

  const missingDifficulty = structuredClone(catalog);
  delete missingDifficulty.challenges[0].difficulty;
  assert.throws(() => game.validateCatalog(missingDifficulty), /challenges\[0\]\.difficulty is required/u);

  const nativeReviewed = structuredClone(catalog);
  nativeReviewed.status = "native-reviewed";
  nativeReviewed.review = {
    status: "native-reviewed",
    reviewer: "Li Wei, native Mandarin educator",
    reviewedAt: "2026-09-01T12:00:00Z",
    notes: "Reviewed every pronunciation, meaning, level, citation, and child-safety decision."
  };
  assert.doesNotThrow(() => game.validateCatalog(nativeReviewed));

  const unqualifiedReviewer = structuredClone(nativeReviewed);
  unqualifiedReviewer.review.reviewer = "AI";
  assert.throws(() => game.validateCatalog(unqualifiedReviewer), /qualified human reviewer/u);

  const impossibleReviewDate = structuredClone(nativeReviewed);
  impossibleReviewDate.review.reviewedAt = "2026-02-30T12:00:00Z";
  assert.throws(() => game.validateCatalog(impossibleReviewDate), /valid ISO date-time/u);

  const cursoryReview = structuredClone(nativeReviewed);
  cursoryReview.review.notes = "Reviewed.";
  assert.throws(() => game.validateCatalog(cursoryReview), /substantively describe/u);

  const prematureReviewer = structuredClone(catalog);
  prematureReviewer.review.reviewer = "Li Wei";
  assert.throws(() => game.validateCatalog(prematureReviewer), /must remain null until native review is complete/u);

  const prematureReviewDate = structuredClone(catalog);
  prematureReviewDate.review.reviewedAt = "2026-09-01T12:00:00Z";
  assert.throws(() => game.validateCatalog(prematureReviewDate), /must remain null until native review is complete/u);
});

test("the catalog boundary normalizes and scans every learner-visible field for child safety", () => {
  const compatibilityUnsafeTitle = structuredClone(catalog);
  compatibilityUnsafeTitle.title = "ＷＥＡＰＯＮ practice";
  assert.throws(() => game.validateCatalog(compatibilityUnsafeTitle), /title contains child-inappropriate English content/u);

  const controlledInstructions = structuredClone(catalog);
  controlledInstructions.instructions += "\u202e";
  assert.throws(() => game.validateCatalog(controlledInstructions), /instructions must not contain Unicode format controls/u);

  const unsafeTranslation = structuredClone(catalog);
  unsafeTranslation.challenges[0].translation = "knife";
  assert.throws(() => game.validateCatalog(unsafeTranslation), /translation contains child-inappropriate English content/u);

  const unsafeWarTranslation = structuredClone(catalog);
  unsafeWarTranslation.challenges[0].translation = "war";
  assert.throws(() => game.validateCatalog(unsafeWarTranslation), /translation contains child-inappropriate English content/u);

  const compatibilityUnsafePoison = structuredClone(catalog);
  compatibilityUnsafePoison.title = "ＰＯＩＳＯＮ lesson";
  assert.throws(() => game.validateCatalog(compatibilityUnsafePoison), /title contains child-inappropriate English content/u);

  const unsafeHanzi = structuredClone(catalog);
  unsafeHanzi.challenges[0].hanzi = "刀";
  assert.throws(() => game.validateCatalog(unsafeHanzi), /hanzi contains a child-inappropriate standalone Hanzi/u);

  const newlyDeniedHanzi = structuredClone(catalog);
  newlyDeniedHanzi.challenges[0].hanzi = "毒";
  assert.throws(() => game.validateCatalog(newlyDeniedHanzi), /hanzi contains a child-inappropriate standalone Hanzi/u);

  const unsafeMandarinWar = structuredClone(catalog);
  unsafeMandarinWar.instructions = "学习战争。";
  assert.throws(() => game.validateCatalog(unsafeMandarinWar), /instructions contains child-inappropriate Mandarin content/u);

  const unsafeMandarinPoison = structuredClone(catalog);
  unsafeMandarinPoison.instructions = "学习中毒。";
  assert.throws(() => game.validateCatalog(unsafeMandarinPoison), /instructions contains child-inappropriate Mandarin content/u);

  const ordinaryHealthLanguage = structuredClone(catalog);
  ordinaryHealthLanguage.instructions = "Visit a clinic for an ache; ask a doctor about medicine when you are hurt.";
  assert.doesNotThrow(() => game.validateCatalog(ordinaryHealthLanguage));
});

test("isolated alternate-reading glyphs retain citation readings rather than contextual tone sandhi", () => {
  const contextualMutations = new Map([
    ["不", { pinyin: "bú", tone: 2 }],
    ["谢", { pinyin: "xie", tone: 5 }],
    ["一", { pinyin: "yí", tone: 2 }],
    ["上", { pinyin: "shang", tone: 5 }],
    ["奶", { pinyin: "nai", tone: 5 }]
  ]);

  for (const [hanzi, contextualReading] of contextualMutations) {
    const mutated = structuredClone(catalog);
    const challenge = mutated.challenges.find((entry) => entry.hanzi === hanzi);
    assert.ok(challenge, `missing alternate-reading audit challenge ${hanzi}`);
    Object.assign(challenge, contextualReading);
    assert.throws(
      () => game.validateCatalog(mutated),
      new RegExp(`must use the citation reading .+ for isolated ${hanzi}`, "u")
    );
  }
});

test("every challenge cites a Word World concept with the exact Hanzi and pinyin reading", () => {
  const guidesByConcept = new Map(readingGuides.entries.map((entry) => [entry.conceptId, entry]));
  assert.equal(guidesByConcept.size, readingGuides.entries.length);

  for (const challenge of catalog.challenges) {
    for (const sourceConceptId of challenge.sourceConceptIds) {
      const guide = guidesByConcept.get(sourceConceptId);
      assert.ok(guide, `${challenge.id} cites missing Word World concept ${sourceConceptId}.`);
      const hasExactReading = guide.tokens.some((token) => token.units.some((unit) => (
        unit.surface === challenge.hanzi
        && unit.notation.normalize("NFC") === challenge.pinyin.normalize("NFC")
      )));
      assert.ok(
        hasExactReading,
        `${challenge.id} (${challenge.hanzi} ${challenge.pinyin}) is not an exact reading unit in ${sourceConceptId}.`
      );
    }
  }
});

test("Mandarin contexts preserve exact source words, readings and English meanings for every character", async () => {
  const authority = await readJson("apps/languages/mandarin-simplified/content/word-world/content.json");
  const records = new Map(authority.records.map(record => [record.id, record]));
  assert.deepEqual(projectMandarinNucleusContexts(catalog, authority), catalog, "the maintained projection is reproducible");
  for (const challenge of catalog.challenges) {
    const context = challenge.context;
    assert.ok(context, challenge.id);
    assert.ok(challenge.sourceConceptIds.includes(context.sourceConceptId), challenge.id);
    const record = records.get(context.sourceConceptId);
    const token = record.tokens.find(token => token.surface === context.text);
    if (token) {
      assert.equal(context.meaning, token.gloss, challenge.id);
      assert.equal(context.notation, token.readingUnits.map(unit => unit.pronunciation.notation).join(" "), challenge.id);
    } else {
      assert.equal(context.text, record.targetText, challenge.id);
      assert.equal(context.meaning, record.englishText, challenge.id);
      assert.equal(context.notation, record.tokens.flatMap(token => token.readingUnits).map(unit => unit.pronunciation.notation).join(" "), challenge.id);
    }
    assert.ok(Object.isFrozen(validatedCatalog.challenges.find(item => item.id === challenge.id).context));
    assert.doesNotMatch(challenge.englishAuditText, /\p{Script=Han}/u, challenge.id);
  }
  assert.equal(catalog.challenges.find(item => item.hanzi === "乐").context.text, "音乐");
  assert.equal(catalog.challenges.find(item => item.hanzi === "觉").context.text, "睡觉");
  assert.equal(catalog.review.status, "native-review-required");
  const schema = await readJson("tools/language-packs/schemas/naturalization-nucleus.preview.v1.schema.json");
  assert.equal(schema.$id, catalog.$schema);
  assert.equal(schema.$defs.context.additionalProperties, false);
  assert.deepEqual(schema.$defs.context.required, ["text", "notation", "meaning", "sourceConceptId"]);
});

test("optional Mandarin context cannot change the character reading, leak scripts or cite another source", () => {
  const legacy = structuredClone(catalog);
  legacy.challenges.forEach(challenge => { delete challenge.context; delete challenge.englishAuditText; });
  assert.equal(game.validateCatalog(legacy).challenges.length, catalog.challenges.length);
  for (const change of [
    challenge => { challenge.context.sourceConceptId = "unrelated.source"; },
    challenge => { challenge.context.notation = challenge.context.notation.replace(challenge.pinyin, "wò"); },
    challenge => { challenge.context.text = "你好"; challenge.context.notation = "nǐ hǎo"; },
    challenge => { challenge.context.text = "<img>"; },
    challenge => { challenge.context.notation = "<script>"; },
    challenge => { challenge.context.meaning = "中文"; },
    challenge => { delete challenge.context.meaning; },
    challenge => { challenge.context.extra = "not part of the contract"; },
    challenge => { challenge.englishAuditText = "friend (朋友)"; }
  ]) {
    const changed = structuredClone(catalog);
    change(changed.challenges[0]);
    assert.throws(() => game.validateCatalog(changed));
  }
  const arabic = structuredClone(arabicCatalog);
  arabic.challenges[0].context = structuredClone(catalog.challenges[0].context);
  assert.throws(() => game.validateCatalog(arabic), /unsupported field/u);
});

test("context is revealed only by a match and its playback remains separate from the isolated character", async () => {
  const fixture = createLoadingHarness();
  const spoken = [];
  fixture.window.CaatuuChrome = { speakText: async text => { spoken.push(text); } };
  await fixture.api.mount();
  await fixture.advance(1600);
  const feedback = fixture.element("Feedback");
  const section = feedback.querySelector(".naturalization-nucleus-context");
  const example = feedback.querySelector(".naturalization-nucleus-context-text");
  const play = feedback.querySelector(".naturalization-nucleus-context-play");
  const tile = fixture.element("Deck").querySelector("button[data-naturalization-piece-id]");
  const id = tile.dataset.naturalizationPieceId.split("--")[0];
  const challenge = catalog.challenges.find(item => item.id === id);
  tile.click();
  assert.equal(section.hidden, true);
  assert.equal(example.textContent, "");
  assert.equal(play.disabled, true);
  play.click();
  await settle();
  assert.deepEqual(spoken, [], "context cannot be an answer hint before the match");
  fixture.element("Ring").querySelectorAll("[data-naturalization-challenge-id]")
    .find(socket => socket.dataset.naturalizationChallengeId !== id).click();
  assert.equal(section.hidden, true, "an unsuccessful match does not reveal the example");
  assert.equal(example.textContent, "");
  await fixture.advance(900);
  fixture.element("Ring").querySelector(`[data-naturalization-challenge-id="${id}"]`).click();
  await settle();
  assert.equal(section.hidden, false);
  assert.equal(example.textContent, challenge.context.text);
  assert.equal(feedback.querySelector(".naturalization-nucleus-context-notation").textContent, challenge.context.notation);
  assert.equal(feedback.querySelector(".naturalization-nucleus-context-meaning").textContent, challenge.context.meaning);
  await fixture.advance(0);
  assert.equal(spoken.at(-1), challenge.hanzi, "automatic match pronunciation retains the isolated cue");
  play.click();
  await settle();
  assert.equal(spoken.at(-1), challenge.context.text);
  fixture.element("FeedbackSound").click();
  await settle();
  assert.equal(spoken.at(-1), challenge.hanzi);
  const calls = spoken.length;
  fixture.element("Deck").querySelector("button[data-naturalization-piece-id]").click();
  assert.equal(section.hidden, true);
  assert.equal(example.textContent, "", "the prior matched example is cleared when another tile is selected");
  play.click();
  await settle();
  assert.equal(spoken.length, calls);
  fixture.window.dispatchEvent({ type: "pagehide", persisted: false });
});

test("difficulty metadata selects one exact band and keeps each band playable", () => {
  const leveledCatalog = structuredClone(catalog);
  leveledCatalog.challenges = leveledCatalog.challenges.filter(challenge => challenge.difficulty !== 0);
  leveledCatalog.challenges.forEach((challenge, index) => {
    challenge.difficulty = index < 12 ? 1 : (index < 24 ? 2 : 3);
  });
  const validated = game.validateCatalog(leveledCatalog);

  assert.equal(game.filterChallengesForDifficulty(validated.challenges, 1).length, 12);
  assert.equal(game.filterChallengesForDifficulty(validated.challenges, 2).length, 12);
  assert.equal(game.filterChallengesForDifficulty(validated.challenges, 3).length, validated.challenges.length - 24);
  assert.equal(game.filterChallengesForDifficulty(validated.challenges, 99).length, 12);

  for (const difficulty of [1, 2, 3]) {
    for (let seed = 1; seed <= 12; seed += 1) {
      const round = game.createRound(validated, 9, seededRandom((difficulty * 100) + seed), "", difficulty);
      assert.equal(round.difficulty, difficulty);
      assert.ok(round.pieces.every(({ left, right }) => (
        left.difficulty === difficulty && right.difficulty === difficulty
      )));
    }
  }

  const invalidDifficulty = structuredClone(leveledCatalog);
  invalidDifficulty.challenges[0].difficulty = 4;
  assert.throws(() => game.validateCatalog(invalidDifficulty), /difficulty must be an integer/u);

  const insufficientLevelOne = structuredClone(leveledCatalog);
  insufficientLevelOne.challenges.forEach((challenge) => { challenge.difficulty = 2; });
  assert.throws(() => game.validateCatalog(insufficientLevelOne), /Level 1 must provide at least 9 distinct pinyin readings/u);
});

test("generated domino decks contain one closed cycle but begin scrambled", () => {
  for (const pieceCount of [5, 9]) {
    for (let seed = 1; seed <= 24; seed += 1) {
      const round = game.createRound(validatedCatalog, pieceCount, seededRandom(seed));
      assert.equal(round.pieces.length, pieceCount);
      assert.equal(round.solution.length, pieceCount);
      assert.equal(game.countConnections(round.solution), pieceCount);
      assert.ok(game.countConnections(round.pieces) <= Math.floor(pieceCount / 3));
      assert.equal(new Set(round.pieces.map(({ left }) => game.readingKey(left))).size, pieceCount);
      assert.equal(new Set(round.pieces.map(({ right }) => game.readingKey(right))).size, pieceCount);
      for (const piece of round.pieces) assert.notEqual(game.readingKey(piece.left), game.readingKey(piece.right));

      const leftReadings = round.solution.map(({ left }) => game.readingKey(left)).sort();
      const rightReadings = round.solution.map(({ right }) => game.readingKey(right)).sort();
      assert.deepEqual(leftReadings, rightReadings);
      assert.equal(game.countConnections([...round.solution.slice(2), ...round.solution.slice(0, 2)]), pieceCount);
      assert.ok(game.countConnections([...round.solution].reverse()) < pieceCount);
    }
  }
});

test("Hanzi tiles match only their pinyin socket and complete 5/9 orbits", () => {
  for (const pieceCount of [5, 9]) {
    const round = game.createRound(validatedCatalog, pieceCount, seededRandom(30 + pieceCount));
    const targets = round.solution.map(({ left }) => left);
    let placements = Array.from({ length: pieceCount }, () => "");
    const wrongPiece = round.pieces.find(({ left }) => game.readingKey(left) !== game.readingKey(targets[0]));
    assert.equal(game.placeHanzi(placements, wrongPiece, targets, 0), null);

    for (let socketIndex = 0; socketIndex < pieceCount; socketIndex += 1) {
      const candidate = round.pieces.find(({ left }) => game.readingKey(left) === game.readingKey(targets[socketIndex]));
      const transition = game.placeHanzi(placements, candidate, targets, socketIndex);
      assert.ok(transition);
      assert.deepEqual([...transition.matchSlots], [socketIndex]);
      assert.equal(transition.matches[0].id, targets[socketIndex].id);
      assert.equal(transition.solved, socketIndex === pieceCount - 1);
      assert.equal(game.placeHanzi(transition.placements, candidate, targets, socketIndex), null);
      placements = [...transition.placements];
    }
  }
});

test("a matching pair starts a chain in either selection order", () => {
  const round = game.createRound(validatedCatalog, 5, seededRandom(41));
  const [first, second] = round.solution;
  const forward = game.seedChain(first, second, 0);
  const reverse = game.seedChain(second, first, 0);

  assert.ok(forward);
  assert.ok(reverse);
  assert.equal(forward.chain[0].id, first.id);
  assert.equal(forward.chain[1].id, second.id);
  assert.equal(reverse.chain[0].id, first.id);
  assert.equal(reverse.chain[1].id, second.id);
  assert.equal(forward.matches[0].id, second.left.id);
  assert.equal(game.seedChain(first, first, 0), null);
  assert.equal(game.seedChain(first, round.solution[3], 0), null);

  const view = game.describeChain(forward.chain, 5, forward.headSlot, false);
  assert.equal(view.matches.length, 1);
  assert.equal(view.matches[0].slot, 0);
  assert.equal(view.leftEnd.slot, 4);
  assert.equal(view.leftEnd.challenge.id, first.left.id);
  assert.equal(view.rightEnd.slot, 1);
  assert.equal(view.rightEnd.challenge.id, second.right.id);
});

test("dominoes grow from either hanging end and never create an early loop", () => {
  const round = game.createRound(validatedCatalog, 5, seededRandom(52));
  const [first, second, third, fourth, fifth] = round.solution;
  const seed = game.seedChain(first, second, 0);
  const appended = game.attachPiece(seed.chain, third, 5, seed.headSlot);
  assert.equal(appended.side, "append");
  assert.equal(appended.chain.at(-1).id, third.id);
  assert.equal(appended.matchSlots[0], 1);

  const prepended = game.attachPiece(seed.chain, fifth, 5, seed.headSlot);
  assert.equal(prepended.side, "prepend");
  assert.equal(prepended.chain[0].id, fifth.id);
  assert.equal(prepended.headSlot, 4);
  assert.equal(prepended.matchSlots[0], 4);

  assert.equal(game.attachPiece(seed.chain, fourth, 5, seed.headSlot), null);
  assert.equal(game.attachPiece(seed.chain, first, 5, seed.headSlot), null);
  assert.equal(seed.chain.length, 2);
});

test("the final domino must satisfy both ends and closes every 5/9 socket", () => {
  for (const pieceCount of [5, 9]) {
    const round = game.createRound(validatedCatalog, pieceCount, seededRandom(60 + pieceCount));
    let transition = game.seedChain(round.solution[0], round.solution[1], 0);
    for (let index = 2; index < pieceCount - 1; index += 1) {
      transition = game.attachPiece(transition.chain, round.solution[index], pieceCount, transition.headSlot);
      assert.ok(transition);
      assert.equal(transition.closed, false);
    }

    const viewBeforeClose = game.describeChain(transition.chain, pieceCount, transition.headSlot, false);
    assert.equal(viewBeforeClose.matches.length, pieceCount - 2);
    assert.ok(viewBeforeClose.leftEnd);
    assert.ok(viewBeforeClose.rightEnd);
    assert.notEqual(viewBeforeClose.leftEnd.slot, viewBeforeClose.rightEnd.slot);

    const finalPiece = round.solution.at(-1);
    const oneSidedFinalPiece = { ...finalPiece, right: round.solution[2].right };
    assert.equal(game.attachPiece(transition.chain, oneSidedFinalPiece, pieceCount, transition.headSlot), null);

    const closed = game.attachPiece(transition.chain, finalPiece, pieceCount, transition.headSlot);
    assert.ok(closed);
    assert.equal(closed.side, "close");
    assert.equal(closed.closed, true);
    assert.equal(closed.chain.length, pieceCount);
    assert.equal(closed.matches.length, 2);
    assert.equal(new Set(closed.matchSlots).size, 2);

    const solved = game.describeChain(closed.chain, pieceCount, closed.headSlot, closed.closed);
    assert.equal(solved.solved, true);
    assert.equal(solved.matches.length, pieceCount);
    assert.equal(new Set(solved.matches.map(({ slot }) => slot)).size, pieceCount);
    assert.equal(solved.leftEnd, null);
    assert.equal(solved.rightEnd, null);
    assert.equal(game.attachPiece(closed.chain, finalPiece, pieceCount, closed.headSlot), null);
  }
});

test("round generation avoids visible homophone ambiguity and immediate artwork repeats", () => {
  const duplicate = {
    ...validatedCatalog.challenges[0],
    id: "zh.hanzi.synthetic-homophone",
    hanzi: "在",
    pinyin: validatedCatalog.challenges[3].pinyin,
    tone: validatedCatalog.challenges[3].tone
  };
  const homophoneCatalog = {
    ...validatedCatalog,
    challenges: [duplicate, ...validatedCatalog.challenges]
  };
  for (let seed = 1; seed <= 16; seed += 1) {
    const previousArtwork = catalog.roundSettings.artwork[0];
    const round = game.createRound(homophoneCatalog, 9, seededRandom(seed), previousArtwork);
    assert.equal(new Set(round.pieces.map(({ left }) => game.readingKey(left))).size, 9);
    assert.notEqual(round.artworkSrc, previousArtwork);
  }

  const insufficientCatalog = {
    roundSettings: { pieceCounts: [5], artwork: [catalog.roundSettings.artwork[0]] },
    challenges: [
      validatedCatalog.challenges[0],
      validatedCatalog.challenges[1],
      validatedCatalog.challenges[2],
      validatedCatalog.challenges[3],
      duplicate
    ]
  };
  assert.throws(() => game.createRound(insufficientCatalog, 5, seededRandom(1)), /distinct readings/u);
});

test("Nucleus has a shared renderer and course-owned catalogs in offline and Android delivery", () => {
  const mandarinOffline = JSON.stringify(mandarinSetup.offline.assets);
  const czechOffline = JSON.stringify(czechSetup.offline.assets);
  for (const fragment of [
    "data/games/naturalization-nucleus/content.json",
    "/assets/planets/naturalization-nucleus.png"
  ]) {
    const pattern = new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    assert.match(mandarinOffline, pattern);
    assert.doesNotMatch(czechOffline, pattern);
  }
  assert.ok(androidAssets.files.includes("data/games/naturalization-nucleus/content.json"));
  for (const extension of ["js", "css"]) {
    const output = `language-runtime/static/source/games/naturalization-nucleus/naturalization-nucleus.${extension}`;
    assert.ok(appAssets.assets.some(mapping => mapping.source === `apps/${output}` && mapping.output === output));
    assert.ok(mandarinSetup.offline.assets.some(url => url.split("?")[0] === `/${output}`));
    assert.ok(czechSetup.offline.assets.some(url => url.split("?")[0] === `/${output}`));
  }

  for (const robotAsset of [
    "/assets/robots/keymap.json",
    "/assets/robots/robot%20(1).png"
  ]) assert.ok(mandarinSetup.offline.assets.includes(robotAsset));

  for (const src of catalog.roundSettings.artwork) {
    assert.ok(mandarinSetup.offline.assets.includes(src));
    assert.ok(czechSetup.offline.assets.includes(src));
    const decoded = decodeURIComponent(src.replace(/^\//u, ""));
    assert.ok(appAssets.assets.some(({ source, output }) => (
      source === `apps/launcher/static/${decoded}` && output === decoded
    )));
  }
});
