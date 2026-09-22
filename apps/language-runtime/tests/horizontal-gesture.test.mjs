import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { bindHorizontalGesture } from "../static/source/horizontal-gesture.mjs";
import { createBrowserHarness } from "./helpers/fake-browser.mjs";

const wordWorld = await readFile(new URL("../static/source/product-word-world.mjs", import.meta.url), "utf8");
const wordWorldBinding = ["bindSentenceGestures", "robotLoadingActive", "syncRobotLoadingActivity", "suspendStarterWordPresentation"]
  .map((name) => {
    const start = wordWorld.indexOf(`function ${name}(`);
    assert.ok(start >= 0, `${name} exists`);
    return wordWorld.slice(start, wordWorld.indexOf("\n}", start) + 2);
  }).join("\n");

function fixture({ wordWorld = false, ...options } = {}) {
  const harness = createBrowserHarness();
  const { document, window } = harness;
  const surface = document.createElement("section");
  surface.className = "word-net-sentence-panel";
  const content = document.createElement("div");
  const button = document.createElement("button");
  surface.append(content, button);
  document.body.append(surface);
  // The general fake DOM does not model capture. Deliver these listeners in
  // browser order before the target so suppression tests exercise ownership.
  const captures = new Map();
  const add = document.addEventListener.bind(document);
  const remove = document.removeEventListener.bind(document);
  document.addEventListener = (type, handler, options) => {
    if (options === true || options?.capture) {
      if (!captures.has(type)) captures.set(type, new Set());
      captures.get(type).add(handler);
    } else add(type, handler, options);
  };
  document.removeEventListener = (type, handler, options) => {
    if (options === true || options?.capture) captures.get(type)?.delete(handler);
    else remove(type, handler, options);
  };
  const emit = (type, values = {}, target = content) => {
    const event = { type, target, bubbles: true, pointerType: "touch", pointerId: 1, isPrimary: true,
      button: 0, clientX: 300, clientY: 100, timeStamp: 100, detail: 1,
      preventDefault() { this.defaultPrevented = true; },
      stopImmediatePropagation() { this.immediatePropagationStopped = true; this.propagationStopped = true; },
      ...values };
    for (const handler of captures.get(type) || []) {
      handler(event);
      if (event.immediatePropagationStopped) break;
    }
    if (!event.propagationStopped) target.dispatchEvent(event);
    return event;
  };
  const actions = [];
  const previews = [];
  const state = { active: true, round: {}, loadingActive: true, loadingPageHidden: false,
    loadingActivityWaiters: new Set(), busy: false, phraseRequestId: 0,
    reconstruction: {}, currentSentence: "First sentence" };
  let controller;
  if (wordWorld) {
    Object.assign(harness.context, { state, bindHorizontalGesture, $: (selector) => document.querySelector(selector),
      activateNextSentence: () => actions.push("next"), showPreviousSentence: () => actions.push("previous"),
      clearTranslationTimer() {}, cancelBackgroundWork() {}, abortWordLookup() {} });
    vm.runInContext(wordWorldBinding, harness.context);
    harness.context.bindSentenceGestures();
    controller = state.swipeGesture;
  } else {
    controller = bindHorizontalGesture({ surface, document, window,
      available: () => state.active, identity: () => state.round,
      onAction: (action) => actions.push(action), onPreview: (action) => previews.push(action), ...options });
  }
  return { ...harness, surface, content, button, emit, actions, previews, state, controller };
}

test("a deliberate swipe acts once on release; taps and native button activation remain native", () => {
  const game = fixture();
  let buttonClicks = 0;
  game.button.addEventListener("click", () => { buttonClicks += 1; });
  game.emit("pointerdown");
  game.emit("pointermove", { clientX: 400 });
  assert.deepEqual(game.actions, []);
  game.emit("pointerup", { clientX: 400 });
  game.emit("pointerup", { clientX: 400 });
  assert.deepEqual(game.actions, ["right"]);
  assert.equal(game.emit("click", { clientX: 400 }).defaultPrevented, true);
  game.emit("click", { detail: 0, pointerId: -1 }, game.button);
  game.emit("pointerdown", {}, game.button);
  game.emit("pointerup", {}, game.button);
  game.emit("click", {}, game.button);
  assert.equal(buttonClicks, 2);
  assert.deepEqual(game.actions, ["right"]);
});

test("gesture compatibility click is suppressed before target handlers, without a global debounce", () => {
  for (const pointerId of [1, undefined]) {
    const game = fixture();
    let clicks = 0;
    game.content.addEventListener("click", () => { clicks += 1; });
    game.emit("pointerdown");
    game.emit("pointerup", { clientX: 400 });
    game.emit("click", { clientX: 400, pointerId });
    assert.equal(clicks, 0);
    game.emit("pointerdown", { clientX: 400 });
    game.emit("pointerup", { clientX: 400 });
    game.emit("click", { clientX: 400, pointerId });
    assert.equal(clicks, 1, "the next physical tap is accepted immediately");
  }
});

test("pending gesture suppression preserves keyboard activation and unrelated pointer clicks", () => {
  const game = fixture();
  let clicks = 0;
  game.button.addEventListener("click", () => { clicks += 1; });
  game.emit("pointerdown");
  game.emit("pointerup", { clientX: 400 });
  game.emit("click", { detail: 0, pointerId: -1 }, game.button);
  assert.equal(clicks, 1, "keyboard or assistive activation is not the gesture's click");
  assert.equal(game.emit("click", { clientX: 400 }).defaultPrevented, true);
  game.emit("pointerdown");
  game.emit("pointerup", { clientX: 400 });
  game.emit("click", { pointerId: 2 }, game.button);
  assert.equal(clicks, 2, "an unrelated pointer is not suppressed");
});

test("multi-contact, scrolling, cancellation and changed ownership cannot become swipes", () => {
  const cancellations = {
    "second contact outside": (game) => game.emit("pointerdown", { pointerId: 2, isPrimary: false }, game.document.body),
    "vertical scroll": (game) => game.emit("pointermove", { clientY: 160 }),
    "scroll event": (game) => game.emit("scroll"),
    "pointercancel": (game) => game.emit("pointercancel"),
    "lost capture": (game) => game.surface.dispatchEvent({ type: "lostpointercapture" }),
    "blur": (game) => game.window.dispatchEvent({ type: "blur" }),
    "pagehide": (game) => game.window.dispatchEvent({ type: "pagehide" }),
    "keyboard interaction": (game) => game.emit("keydown", { key: "Escape", detail: 0 }),
    "hidden document": (game) => {
      game.document.hidden = true;
      game.emit("visibilitychange");
      game.document.hidden = false;
    },
    "round changed": (game) => { game.state.round = {}; },
    "surface detached": (game) => game.surface.remove(),
    "inactive": (game) => { game.state.active = false; }
  };
  for (const [name, cancel] of Object.entries(cancellations)) {
    const game = fixture();
    game.emit("pointerdown");
    cancel(game);
    game.emit("pointerup", { clientX: 400 });
    assert.deepEqual(game.actions, [], name);
  }
});

test("pinching cannot restart a gesture while another contact remains down", () => {
  const game = fixture();
  game.emit("pointerdown");
  game.emit("pointerdown", { pointerId: 2, isPrimary: false }, game.document.body);
  game.emit("pointerup", { clientX: 400 });
  game.emit("pointerdown", { pointerId: 3 });
  game.emit("pointerup", { pointerId: 3, clientX: 400 });
  assert.deepEqual(game.actions, []);
  game.emit("pointerup", { pointerId: 2 });
  game.emit("pointerdown");
  game.emit("pointerup", { clientX: 400 });
  assert.deepEqual(game.actions, ["right"]);
});

test("reserved edges, controls, editable regions and disposed owners never claim gestures", () => {
  for (const start of [0, 36, 1164, 1199]) {
    const game = fixture();
    game.emit("pointerdown", { clientX: start });
    game.emit("pointerup", { clientX: start + (start > 600 ? -100 : 100) });
    assert.deepEqual(game.actions, []);
  }
  for (const attribute of ["contenteditable", "role"]) {
    const game = fixture();
    game.content.setAttribute(attribute, attribute === "role" ? "slider" : "true");
    game.emit("pointerdown");
    game.emit("pointerup", { clientX: 400 });
    assert.deepEqual(game.actions, []);
  }
  const game = fixture();
  game.emit("pointerdown");
  game.controller.dispose();
  game.emit("pointerup", { clientX: 400 });
  game.emit("pointerdown");
  game.emit("pointerup", { clientX: 400 });
  assert.deepEqual(game.actions, []);
});

test("Word World's actual binding preserves next/previous directions and touch-only thresholds", () => {
  for (const [dx, pointerType, elapsed, expected] of [
    [-100, "touch", 500, "next"], [100, "touch", 500, "previous"],
    [-30, "touch", 500, null], [-100, "mouse", 500, null], [-100, "touch", 1300, null]
  ]) {
    const game = fixture({ wordWorld: true });
    game.emit("pointerdown", { pointerType });
    game.emit("pointerup", { pointerType, clientX: 300 + dx, timeStamp: 100 + elapsed });
    assert.deepEqual(game.actions, expected ? [expected] : []);
  }
});

test("Word World rejects multi-contact and a swipe whose sentence, attempt, request or activity changed", () => {
  const changes = {
    "outside contact": (game) => game.emit("pointerdown", { pointerId: 2, isPrimary: false }, game.document.body),
    "request": (game) => { game.state.phraseRequestId += 1; },
    "attempt": (game) => { game.state.reconstruction = {}; },
    "sentence": (game) => { game.state.currentSentence = "Another sentence"; },
    "busy": (game) => { game.state.busy = true; },
    "pause and resume": (game) => {
      game.state.loadingActive = false;
      game.context.syncRobotLoadingActivity();
      game.state.loadingActive = true;
    },
    "suspended presentation": (game) => game.context.suspendStarterWordPresentation(),
    "menu opened": (game) => {
      const menu = game.document.createElement("div");
      menu.id = "wordNetAudioMenu";
      game.surface.append(menu);
    }
  };
  for (const [name, change] of Object.entries(changes)) {
    const game = fixture({ wordWorld: true });
    game.emit("pointerdown");
    change(game);
    game.emit("pointerup", { clientX: 200 });
    assert.deepEqual(game.actions, [], name);
  }
});
