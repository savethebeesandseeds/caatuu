import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { createReviewContinuation } from "../static/source/games/practice-pacing.mjs";
import { createBrowserHarness } from "./helpers/fake-browser.mjs";

const source = await readFile(new URL("../static/source/caatuu-workspace.js", import.meta.url), "utf8");
const between = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function fixture(gameId = "verb-lab") {
  let serial = 0; const frames = new Map();
  const browser = createBrowserHarness({ window: {
    requestAnimationFrame(callback) { const id = ++serial; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); }
  } });
  const panel = browser.document.createElement("section"); panel.setAttribute("data-train-panel", gameId); browser.document.body.append(panel);
  const state = { activeView: "verbs", trainTab: gameId, verbRoundTransitionId: 1, verbHintsEnabled: true };
  browser.window.CaatuuGameDynamics = { active: false };
  Object.assign(browser.context, { state, shellRobotPageHidden: false });
  vm.runInContext(between("const practicePresentationWaits =", "async function preloadVerbHintsForRound"), browser.context);
  const frame = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(60_000)); };
  return { ...browser, state, panel, frames, frame, wait: () => browser.context.waitForPracticePresentation(gameId) };
}

test("readiness never replaces content while menus, rewards or another view own attention", async () => {
  for (const reason of ["menu", "dialog", "reward", "inactive", "background"]) {
    const f = fixture(), control = f.document.createElement("details"); f.panel.append(control);
    const pause = value => {
      if (reason === "menu") control.toggleAttribute("open", value);
      if (reason === "dialog") { control.setAttribute("aria-haspopup", "menu"); control.setAttribute("aria-expanded", String(value)); }
      if (reason === "speech") control.classList.toggle("is-speaking", value);
      if (reason === "reward") f.window.CaatuuGameDynamics.active = value;
      if (reason === "inactive") f.state.activeView = value ? "home" : "verbs";
      if (reason === "background") f.document.visibilityState = value ? "hidden" : "visible";
    };
    pause(true); const wait = f.wait(); let done = false; void wait.promise.then(() => { done = true; });
    for (let i = 0; i < 10; i++) f.frame(); await settle(); assert.equal(done, false, reason);
    pause(false); f.frame(); assert.equal(await wait.promise, true); assert.equal(f.frames.size, 0);
  }
});

test("shared settings and visible embedded tools block readiness; hidden menus do not", async () => {
  const f = fixture("conjugation-comet"), child = createBrowserHarness();
  const frame = f.document.createElement("iframe"); frame.contentDocument = child.document; f.panel.append(frame);
  const menu = child.document.createElement("details"); menu.setAttribute("open", ""); child.document.body.append(menu);
  const wait = f.wait(); let done = false; void wait.promise.then(() => { done = true; });
  f.frame(); await settle(); assert.equal(done, false); menu.hidden = true;
  const settings = f.document.createElement("section"); settings.id = "settingsPanel"; f.document.body.append(settings);
  f.frame(); await settle(); assert.equal(done, false); settings.hidden = true; f.frame(); assert.equal(await wait.promise, true);
});

test("cancellation fences callbacks already queued by the browser", async () => {
  for (const cancel of [f => f.context.cancelPracticePresentationWaits("verb-lab"), f => f.window.dispatchEvent({ type: "pagehide", persisted: false })]) {
    const f = fixture(), wait = f.wait(), callback = [...f.frames.values()][0]; cancel(f);
    assert.equal(await wait.promise, false); callback(); assert.equal(f.frames.size, 0);
  }
});

test("late image readiness respects rewards and has no forced loading interval", async () => {
  const f = fixture(); let finishImages, applied = 0;
  Object.assign(f.context, { renderVerbNebula() {}, setVerbMatchFeedback() {}, interfaceText: id => id,
    preloadVerbHintsForRound: () => new Promise(resolve => { finishImages = resolve; }), applyVerbRound() { applied++; } });
  vm.runInContext(between("async function prepareVerbRound(", "function preloadVerbHintAsset"), f.context);
  const prepared = f.context.prepareVerbRound({ round: [] }, 1);
  f.window.CaatuuGameDynamics.active = true; finishImages(new Map()); await settle(); f.frame(); await settle(); assert.equal(applied, 0);
  f.window.CaatuuGameDynamics.active = false; f.frame(); await prepared; assert.equal(applied, 1);
});

for (const result of ["matched", "revealed"]) test(`Verb ${result} review waits for Continue and consumes repeated input once`, () => {
  const f = fixture(), button = f.document.createElement("button"); button.id = "verbContinue"; f.panel.append(button);
  let advances = 0, exposures = 0;
  Object.assign(f.state, { verbRound: [{ id: "pair" }], verbSolutionRevealed: result === "revealed" });
  f.window.CaatuuPracticePacing = { createReviewContinuation };
  Object.assign(f.context, { $: selector => f.document.querySelector(selector), verbRoundComplete: () => result === "matched",
    recordVerbContentExposure() { exposures++; }, transitionToNextVerbRound() { advances++; f.state.verbRoundTransitioning = true; } });
  vm.runInContext(between("let verbReviewContinuation =", "function waitForVerbTransition"), f.context);
  f.context.renderVerbReviewContinuation(); for (let i = 0; i < 10; i++) f.frame();
  assert.equal(advances, 0); assert.equal(button.hidden, false); button.click(); button.click();
  assert.equal(advances, 1); assert.equal(exposures, result === "revealed" ? 1 : 0);
});

function languageReviewFixture(gameId) {
  const f = fixture(gameId), activity = [];
  f.window.CaatuuGameDynamics.setActive = () => {};
  Object.assign(f.context, { embeddedGameTabs: { "grammar-gravity": {} }, verbReviewContinuation: null,
    cancelVerbTapSpeech() {}, syncShellRobotLoading() {},
    syncEmbeddedWordNetVisibility(active) { if (gameId === "word-net") activity.push(active); },
    syncEmbeddedGameVisibility(active) { if (gameId !== "word-net") activity.push(active === gameId); }
  });
  vm.runInContext(between("function syncActiveGameVisibility()", "function syncEmbeddedWordNetVisibility("), f.context);
  return { ...f, activity };
}

for (const gameId of ["grammar-gravity", "word-net", "verb-lab"]) {
  test(`the global language review suspends ${gameId} and resumes its existing challenge`, async () => {
    const f = languageReviewFixture(gameId);
    f.state.languageReviewOpen = true;
    f.context.syncActiveGameVisibility();
    assert.equal(f.activity.at(-1), false, "game input and timers must pause behind the header menu");
    assert.equal(f.document.body.hasAttribute("data-caatuu-practice-paused"), true, "inline Nucleus shares the same pause boundary");
    const reviewWait = f.wait();
    let presented = false;
    void reviewWait.promise.then(() => { presented = true; });
    f.frame();
    await settle();
    assert.equal(presented, false);
    f.state.languageReviewOpen = false;
    f.context.syncActiveGameVisibility();
    assert.equal(f.activity.at(-1), true);
    assert.equal(f.document.body.hasAttribute("data-caatuu-practice-paused"), false);
    reviewWait.cancel();
  });
}

for (const dialog of [false, true]) test(`${dialog ? "full chooser" : "compact language menu"} pauses games and restores existing Verb button availability`, () => {
  const f = languageReviewFixture("verb-lab");
  Object.assign(f.state, { verbMatchedIds: new Set(["matched"]), verbRoundTransitioning: false,
    verbSolutionRevealed: false });
  Object.assign(f.context, { verbGuidedInteractionLocked: () => false, verbGuidedTargetPending: () => false });
  vm.runInContext(between("function verbMatchCardDisabled(", "function verbMatchCardForId("), f.context);
  const menu = f.document.createElement(dialog ? "dialog" : "div");
  if (dialog) { menu.dataset.languageSelectorMenu = ""; menu.toggleAttribute("open", true); }
  else menu.className = "header-language-menu";
  f.document.body.append(menu);
  const cards = ["ready", "matched"].map(id => {
    const button = f.document.createElement("button");
    button.dataset.verbSide = "cz";
    button.dataset.verbId = id;
    f.panel.append(button);
    return button;
  });
  f.context.syncLanguageReviewVisibility();
  assert.equal(f.state.languageReviewOpen, true);
  assert.equal(f.activity.at(-1), false);
  assert.ok(cards.every(card => card.disabled));
  if (dialog) menu.removeAttribute("open"); else menu.hidden = true;
  f.context.syncLanguageReviewVisibility();
  assert.equal(f.state.languageReviewOpen, false);
  assert.equal(f.activity.at(-1), true);
  assert.equal(cards[0].disabled, false);
  assert.equal(cards[1].disabled, true);
  assert.equal(f.panel.querySelector('[data-verb-id="ready"]'), cards[0], "pointer dismissal preserves the target node");
});

test("workspace startup reads a language menu that opened before its listener attached", async () => {
  const f = languageReviewFixture("grammar-gravity");
  const menu = f.document.createElement("div");
  menu.className = "header-language-menu";
  f.document.body.append(menu);
  Object.assign(f.context, { loadContentData: async () => {}, courseHasCapability: () => false,
    courseGameAvailable: () => false, loadArtifactLicenseCatalog: async () => {},
    applyTheme() {}, readStoredTheme: () => "light", bindUi() {}, renderModelLicenseList() {},
    courseUsesModels: () => false, render() {}, renderDataError(error) { throw error; },
    setInitialViewFromLocation() { f.context.syncActiveGameVisibility(); }
  });
  vm.runInContext(between("async function init()", "function registerServiceWorker()"), f.context);
  const result = await f.context.init();
  assert.equal(result.ready, true);
  assert.equal(f.state.languageReviewOpen, true);
  assert.equal(f.activity.at(-1), false);
  assert.equal(f.document.body.hasAttribute("data-caatuu-practice-paused"), true);
});

test("embedded shell hides its duplicate global freshness notice while preserving save failures", () => {
  const f = fixture("case-cosmos"), child = createBrowserHarness();
  const freshness = child.document.createElement("aside");
  freshness.id = "appFreshnessNotice";
  const saveFailure = child.document.createElement("aside");
  saveFailure.id = "progressSaveNotice";
  child.document.body.append(freshness, saveFailure);
  vm.runInContext(between("function prepareEmbeddedGameDocument(", "function syncEmbeddedGameVisibility("), f.context);
  f.context.prepareEmbeddedGameDocument({ contentDocument: child.document });
  const style = child.document.getElementById("caatuuEmbeddedShellStyle");
  const hiddenSelectors = [...style.textContent.matchAll(/([^{}]+)\{\s*display:\s*none\s*!important\s*;\s*\}/gu)]
    .flatMap(match => match[1].split(",").map(selector => selector.trim()));
  const hiddenByShell = element => hiddenSelectors.some(selector => {
    // The shared fake DOM supports descendant selectors; evaluate this rule's
    // direct-child combinators explicitly against the constructed DOM tree.
    let current = element;
    for (const part of selector.split(/\s*>\s*/u).reverse()) {
      if (!current?.matches(part)) return false;
      current = current.parentElement;
    }
    return true;
  });
  assert.ok(hiddenByShell(freshness), "the parent owns the global browser freshness notice");
  assert.ok(!hiddenByShell(saveFailure), "a child save failure must remain visible");
  f.context.prepareEmbeddedGameDocument({ contentDocument: child.document });
  assert.equal(child.document.querySelectorAll("#caatuuEmbeddedShellStyle").length, 1);
});

for (const pause of ["languageReviewOpen", "shellReviewOpen"]) test(`a late iframe load respects ${pause} set during loading`, () => {
  const f = fixture("grammar-gravity"), messages = [];
  const frame = f.document.createElement("iframe");
  frame.id = "deferredGameFrame";
  frame.dataset.src = "/cz/grammar-gravity.html";
  frame.contentWindow = { postMessage: message => messages.push(message) };
  f.panel.append(frame);
  f.state[pause] = true;
  Object.assign(f.context, {
    embeddedGameTabs: { "grammar-gravity": { frameId: frame.id } },
    prepareEmbeddedGameDocument() {}, setShellRobotLoading() {}
  });
  vm.runInContext(between("function syncEmbeddedGameVisibility(", "function campaignAvailableTabs("), f.context);
  f.context.ensureEmbeddedGameLoaded("grammar-gravity");
  frame.dispatchEvent({ type: "load" });
  assert.equal(frame.dataset.ready, "true");
  assert.equal(messages.at(-1).active, false, "load completion must respect the current global shell pause");
  f.state[pause] = false;
  f.context.syncEmbeddedGameVisibility(f.state.trainTab);
  assert.equal(messages.at(-1).active, true);
});

for (const overlay of ["settings", "home", "games", "dock"]) {
  test(`${overlay} shell overlay pauses active games and resumes only after every covering menu closes`, () => {
    const f = languageReviewFixture("grammar-gravity");
    const control = f.document.createElement("div");
    if (overlay === "settings") control.id = "settingsPanel";
    if (overlay === "home") control.className = "home-menu-backdrop";
    if (overlay === "games") control.className = "games-menu-backdrop";
    if (overlay === "dock") { control.dataset.caatuuBottomDock = ""; control.dataset.openMenu = "settings"; }
    f.document.body.append(control);
    f.context.syncLanguageReviewVisibility();
    assert.equal(f.activity.at(-1), false, "shell browsing owns game attention");
    assert.equal(f.document.body.hasAttribute("data-caatuu-practice-paused"), true);
    const flagMenu = f.document.createElement("div");
    flagMenu.className = "header-language-menu";
    f.document.body.append(flagMenu);
    if (overlay === "dock") delete control.dataset.openMenu; else control.hidden = true;
    f.context.syncLanguageReviewVisibility();
    assert.equal(f.activity.at(-1), false, "closing one covering menu cannot resume through another");
    flagMenu.hidden = true;
    f.context.syncLanguageReviewVisibility();
    assert.equal(f.activity.at(-1), true);
    assert.equal(f.document.body.hasAttribute("data-caatuu-practice-paused"), false);
  });
}

test("shell pause ignores menus inside hidden ancestors and reads an existing Backpack before startup", async () => {
  const f = languageReviewFixture("grammar-gravity");
  const hidden = f.document.createElement("section");
  hidden.hidden = true;
  const panel = f.document.createElement("div");
  panel.id = "settingsPanel";
  hidden.append(panel);
  f.document.body.append(hidden);
  f.context.syncLanguageReviewVisibility();
  assert.equal(f.activity.at(-1), true);
  hidden.hidden = false;
  Object.assign(f.context, { loadContentData: async () => {}, courseHasCapability: () => false,
    courseGameAvailable: () => false, loadArtifactLicenseCatalog: async () => {},
    applyTheme() {}, readStoredTheme: () => "light", bindUi() {}, renderModelLicenseList() {},
    courseUsesModels: () => false, render() {}, renderDataError(error) { throw error; },
    setInitialViewFromLocation() { f.context.syncActiveGameVisibility(); }
  });
  vm.runInContext(between("async function init()", "function registerServiceWorker()"), f.context);
  assert.equal((await f.context.init()).ready, true);
  assert.equal(f.activity.at(-1), false);
});

test("workspace-owned Backpack open and close resync the existing game", () => {
  const f = languageReviewFixture("grammar-gravity");
  const panel = f.document.createElement("div");
  panel.id = "settingsPanel";
  panel.hidden = true;
  f.document.body.append(panel);
  Object.assign(f.context, { $: selector => f.document.querySelector(selector), lastAppSettingsTrigger: null,
    syncThemeControls() {}, courseUsesModels: () => false, syncAppRuntimeControls() {}
  });
  vm.runInContext(between("function openSettingsPanel()", "window.CaatuuHandleAndroidBack ="), f.context);
  f.context.openSettingsPanel();
  assert.equal(f.activity.at(-1), false);
  f.context.closeSettingsPanel();
  assert.equal(f.activity.at(-1), true);
});

test("shell overlays disable existing Verb choices and reject queued stale choice events", () => {
  const f = languageReviewFixture("verb-lab");
  Object.assign(f.state, { shellReviewOpen: true, verbMatchedIds: new Set(), verbRoundTransitioning: false,
    verbSolutionRevealed: false, verbSelectedCzechId: "" });
  Object.assign(f.context, { verbGuidedInteractionLocked: () => false, verbGuidedTargetPending: () => false,
    syncVerbSelectedCards() {}, speakVerbCzechOnTap() {}
  });
  vm.runInContext(between("function verbMatchCardDisabled(", "function verbMatchCardForId("), f.context);
  assert.equal(f.context.verbMatchCardDisabled("ready", "cz"), true);
  const card = f.document.createElement("button");
  card.dataset.verbId = "ready";
  card.dataset.verbSide = "cz";
  f.panel.append(card);
  vm.runInContext(between("function chooseVerbMatchCard(", "function syncVerbSelectedCards("), f.context);
  f.context.chooseVerbMatchCard({ target: card });
  assert.equal(f.state.verbSelectedCzechId, "", "a queued event cannot select through a shell overlay");
});
