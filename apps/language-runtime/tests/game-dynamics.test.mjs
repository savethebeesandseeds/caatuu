import assert from "node:assert/strict";
import test from "node:test";
import { installGameDynamics } from "../static/source/game-dynamics.mjs";
import { createBrowserHarness } from "./helpers/fake-browser.mjs";

const receipt = (id = "set-1") => ({ id, xp: 16, coins: 1, gems: 0 });
const settle = async () => { for (let step = 0; step < 8; step++) await Promise.resolve(); };

test("reward audio plays once when visible, stops on pause/skip, and never repeats on resume", async () => {
  const played = [], unlocked = [];
  let stops = 0, destroyed = 0;
  const sound = { unlock: event => unlocked.push(event), play: reward => played.push(reward),
    stop: () => stops++, destroy: () => destroyed++ };
  const f = fixture({ pending: receipt(), sound });
  f.controller.setActive(true);
  const gesture = { type: "pointerdown", isTrusted: true };
  f.document.dispatchEvent(gesture);
  f.document.dispatchEvent({ type: "pointerup", isTrusted: true, pointerType: "touch" });
  assert.equal(unlocked.length, 2);
  f.document.visibilityState = "hidden";
  const gate = f.controller.boundary();
  await settle();
  assert.equal(played.length, 0, "claiming in the background does not play sound");
  f.document.visibilityState = "visible";
  f.document.dispatchEvent({ type: "visibilitychange" });
  assert.equal(played.length, 1);
  f.document.visibilityState = "hidden";
  f.document.dispatchEvent({ type: "visibilitychange" });
  assert.ok(stops > 0);
  f.document.visibilityState = "visible";
  f.document.dispatchEvent({ type: "visibilitychange" });
  assert.equal(played.length, 1, "resuming does not repeat the cue");
  await f.advance(60000);
  assert.equal(f.controller.active, true, "the finished sound does not dismiss its reward screen");
  assert.equal(played.length, 1, "waiting for Continue does not repeat the cue");
  f.skip().dispatchEvent({ type: "click" });
  assert.equal(await gate, true);
  const afterSkip = stops;
  f.controller.destroy();
  assert.equal(destroyed, 1);
  assert.ok(afterSkip >= 2);
});

test("reward flights target the header, pause when running, and never replay after finishing", async () => {
  const f = fixture({ pending: { ...receipt(), gems: 1 } });
  const animations = [];
  const create = f.document.createElement;
  f.document.createElement = tag => {
    const node = create(tag);
    node.animate = (frames, options) => {
      const animation = { frames, options, playState: "running", plays: 0, pauses: 0, cancels: 0,
        play() { this.plays++; this.playState = "running"; },
        pause() { this.pauses++; this.playState = "paused"; },
        cancel() { this.cancels++; this.playState = "idle"; } };
      animations.push(animation);
      return animation;
    };
    return node;
  };
  for (const kind of ["xp", "coins", "gems"]) {
    const target = f.document.createElement("span");
    target.setAttribute(`data-caatuu-header-${kind}`, "");
    target.getBoundingClientRect = () => ({ left: 40, top: 20, width: 30, height: 30 });
    f.document.body.append(target);
  }
  f.controller.setActive(true);
  const gate = f.controller.boundary();
  await settle();
  assert.equal(animations.length, 6, "bounded decoration, independent of XP amount");
  assert.ok(animations.every(animation => animation.frames.at(-1).transform.includes("translate(43px, 23px)")));
  f.document.visibilityState = "hidden";
  f.document.dispatchEvent({ type: "visibilitychange" });
  assert.ok(animations.every(animation => animation.pauses === 1));
  f.document.visibilityState = "visible";
  f.document.dispatchEvent({ type: "visibilitychange" });
  assert.ok(animations.every(animation => animation.plays === 1));
  animations.forEach(animation => { animation.playState = "finished"; });
  await f.advance(60000);
  f.document.visibilityState = "hidden";
  f.document.dispatchEvent({ type: "visibilitychange" });
  f.document.visibilityState = "visible";
  f.document.dispatchEvent({ type: "visibilitychange" });
  assert.ok(animations.every(animation => animation.pauses === 1), "completed flights stay finished in the background");
  assert.ok(animations.every(animation => animation.plays === 1), "returning to the receipt does not restart completed flights");
  assert.equal(f.controller.active, true);
  f.skip().dispatchEvent({ type: "click" });
  assert.equal(await gate, true);
  assert.ok(animations.every(animation => animation.cancels === 1));
  assert.equal(f.document.body.querySelector(".caatuu-practice-flight-layer"), null);
  f.controller.destroy();
});

test("reduced motion omits flight tokens and spark effects", async () => {
  const f = fixture({ pending: receipt(), reduced: true });
  f.controller.setActive(true);
  const gate = f.controller.boundary();
  await settle();
  assert.equal(f.document.querySelector(".caatuu-practice-flight-layer"), null);
  assert.equal(f.overlay().classList.contains("is-reduced-motion"), true);
  f.skip().dispatchEvent({ type: "click" });
  await gate;
  f.controller.destroy();
});

test("the reward area follows the header and navigation during viewport and chrome changes", async () => {
  const f = fixture({ pending: receipt(), reduced: true });
  const header = f.document.querySelector(".app-header");
  const dock = f.document.createElement("nav");
  dock.className = "app-bottom-dock";
  f.document.body.append(dock);
  let headerBottom = 88, dockTop = 730, dockHeight = 70;
  header.getBoundingClientRect = () => ({ bottom: headerBottom });
  dock.getBoundingClientRect = () => ({ top: dockTop, height: dockHeight });
  let observer;
  f.window.ResizeObserver = class {
    constructor(callback) { this.callback = callback; this.targets = []; this.disconnected = false; observer = this; }
    observe(target) { this.targets.push(target); }
    disconnect() { this.disconnected = true; }
  };
  f.controller.setActive(true);
  const gate = f.controller.boundary();
  await settle();
  const overlay = f.overlay();
  assert.equal(overlay.style.getPropertyValue("--caatuu-reward-top"), "88px");
  assert.equal(overlay.style.getPropertyValue("--caatuu-reward-bottom"), "70px");
  assert.deepEqual(observer.targets, [header, dock]);
  f.window.innerHeight = 650;
  headerBottom = 100;
  dockTop = 580;
  f.window.dispatchEvent({ type: "resize" });
  assert.equal(overlay.style.getPropertyValue("--caatuu-reward-top"), "100px");
  assert.equal(overlay.style.getPropertyValue("--caatuu-reward-bottom"), "70px");
  dockTop = 490;
  dockHeight = 160;
  observer.callback();
  assert.equal(overlay.style.getPropertyValue("--caatuu-reward-bottom"), "160px", "an expanded navigation area remains uncovered");
  headerBottom = 50;
  f.window.dispatchEvent({ type: "scroll" });
  assert.equal(overlay.style.getPropertyValue("--caatuu-reward-top"), "50px");
  f.skip().click();
  assert.equal(await gate, true);
  assert.equal(observer.disconnected, true);
  f.controller.destroy();
});

function fixture({ pending = null, reduced = false, claim, sound } = {}) {
  let now = 0;
  let nextId = 0;
  const timers = new Map();
  const browser = createBrowserHarness({ window: {
    performance: { now: () => now },
    matchMedia: () => ({ matches: reduced }),
    setTimeout(callback, delay) { const id = ++nextId; timers.set(id, { callback, due: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); }
  } });
  const header = browser.document.createElement("header");
  header.className = "app-header";
  const content = browser.document.createElement("section");
  content.setAttribute("data-train-panel", "verb-lab");
  const next = browser.document.createElement("button");
  content.append(next);
  const menu = browser.document.createElement("button");
  browser.document.body.append(header, content, menu);
  let snapshot = { target: 12, effort: 4, completedSets: 0, pending, coins: 0, gems: 0,
    cycle: { sets: 0, target: 16, completed: 0 } };
  const claims = [];
  const pauses = [];
  const boundaries = [];
  const learning = {
    storage: { practiceStorageKey: "course.practice.v1", performanceStorageKey: "course.performance.v1" },
    practiceSet: () => snapshot,
    async claimPracticeSetReward(id) {
      claims.push(id);
      const won = claim ? await claim(id) : snapshot.pending?.id === id;
      if (won) snapshot = { ...snapshot, pending: null };
      return won;
    },
    completePracticeBoundary(gameId) { boundaries.push(gameId); return snapshot; }
  };
  const controller = installGameDynamics({ scope: browser.window, learning, sound,
    onPauseChange: value => pauses.push(value) });
  const update = (value, emit = true) => {
    snapshot = { ...snapshot, ...value };
    if (emit) browser.window.dispatchEvent({ type: "caatuu:learning-change", detail: { practiceSet: snapshot } });
  };
  const advance = async duration => {
    now += duration;
    for (const [id, timer] of [...timers].sort((a, b) => a[1].due - b[1].due)) {
      if (timer.due <= now && timers.has(id)) { timers.delete(id); timer.callback(); }
    }
    await settle();
  };
  const transition = (details = {}) => {
    const gates = [];
    browser.window.dispatchEvent({ type: "caatuu:challenge-transition", detail: {
      content, container: content, active: true, phase: "show", initial: false,
      waitUntil: promise => gates.push(promise), ...details
    } });
    return gates;
  };
  return { ...browser, controller, learning, content, next, menu, claims, pauses, boundaries, update, advance,
    transition, timers, overlay: () => browser.document.body.querySelector(".caatuu-practice-celebration"),
    skip: () => browser.document.body.querySelector(".caatuu-practice-celebration-skip") };
}

test("set progress stays in the header without visible labels or an always-visible cycle", () => {
  const f = fixture();
  f.controller.setActive(true);
  const meter = f.document.querySelector("[data-caatuu-practice-meter]");
  const progress = meter.querySelector("progress");
  assert.equal(meter.parentElement, f.document.querySelector(".app-header"));
  assert.equal(meter.textContent, "");
  assert.equal(meter.querySelectorAll("progress").length, 1);
  assert.equal(progress.max, 12);
  assert.equal(progress.value, 4);
  assert.equal(progress.getAttribute("aria-label"), "Practice set");
  f.update({ effort: 10, cycle: { sets: 7, target: 16 } });
  assert.equal(progress.value, 10);
  assert.equal(meter.textContent, "");
  assert.equal(f.document.querySelector(".caatuu-practice-cycle-progress"), null);
  const query = f.document.querySelector;
  f.document.querySelector = selector => selector === ".app-header" ? null : query(selector);
  f.update({ effort: 11 });
  assert.equal(meter.hidden, true);
  assert.equal(meter.parentElement.tagName, "HEADER", "a missing header never moves the bar to the body");
  f.controller.destroy();
});

test("set completion shows the cycle bar and uses the same XP emblem for the card and flights", async () => {
  const f = fixture({ pending: receipt() });
  f.update({ effort: 2, cycle: { sets: 7, target: 16 } }, false);
  f.controller.setActive(true);
  const gate = f.controller.boundary();
  await settle();
  const row = f.overlay().querySelector(".caatuu-practice-cycle-progress");
  const progress = row.querySelector("progress");
  assert.equal(progress.value, 7);
  assert.equal(progress.max, 16);
  assert.equal(progress.getAttribute("aria-valuetext"), "7 / 16 sets");
  assert.equal(row.textContent, "");
  assert.equal(row.querySelector("img").alt, "");
  assert.equal(row.classList.contains("is-complete"), false);
  assert.equal(f.document.querySelector(".caatuu-practice-meter-progress").value, 2);
  const art = f.overlay().querySelector(".caatuu-practice-reward-xp").querySelector("img");
  assert.equal(art.src, "/language-runtime/static/assets/xp-gold.webp");
  const flights = f.overlay().querySelectorAll(".caatuu-practice-flight-xp");
  assert.equal(flights.length, 2);
  assert.ok(flights.every(flight => flight.querySelector("img").src === art.src));
  f.skip().click();
  assert.equal(await gate, true);
  assert.deepEqual(f.claims, ["set-1"]);
  assert.equal(f.document.body.querySelector(".caatuu-practice-cycle-progress"), null);
  f.controller.destroy();
});

test("a gem milestone displays a full cycle even after the ledger starts the next cycle", async () => {
  const f = fixture({ pending: { ...receipt(), gems: 1 }, reduced: true });
  f.update({ effort: 0, cycle: { sets: 0, target: 16, completed: 1 } }, false);
  f.controller.setActive(true);
  const gate = f.controller.boundary();
  let completed = false;
  void gate.then(() => { completed = true; });
  await settle();
  const row = f.overlay().querySelector(".caatuu-practice-cycle-progress");
  assert.equal(row.querySelector("progress").value, 16);
  assert.equal(row.querySelector("progress").max, 16);
  assert.equal(row.classList.contains("is-complete"), true);
  assert.match(f.overlay().textContent, /\+16XP\+1Coins\+1Gems/u);
  await f.advance(60000);
  assert.equal(f.controller.active, true);
  assert.equal(completed, false, "the gem milestone waits for acknowledgement");
  assert.equal(f.content.hasAttribute("inert"), true);
  f.skip().click();
  assert.equal(await gate, true);
  assert.equal(await f.controller.boundary(), false);
  assert.deepEqual(f.claims, ["set-1"]);
  f.controller.destroy();
});

test("legacy learning APIs remain a no-op and pending receipts do not animate on install", async () => {
  const old = createBrowserHarness();
  const legacy = installGameDynamics({ scope: old.window });
  legacy.setActive(true);
  assert.equal(await legacy.boundary(), false);
  assert.equal(old.document.querySelector("[data-caatuu-practice-meter]"), null);
  legacy.destroy();
  const f = fixture({ pending: receipt() });
  f.controller.setActive(true);
  await settle();
  assert.equal(f.overlay(), null);
  assert.deepEqual(f.claims, []);
  assert.equal(f.document.querySelector("[data-caatuu-practice-meter]").hidden, false);
  f.controller.destroy();
});

test("an earned set pauses the game synchronously, waits for the claim, and presents one bundle", async () => {
  let confirm;
  const f = fixture({ pending: { ...receipt(), gems: 1 }, claim: () => new Promise(resolve => { confirm = resolve; }) });
  f.controller.setActive(true);
  f.next.focus();
  const gate = f.controller.boundary({ content: f.content });
  let completed = false;
  void gate.then(() => { completed = true; });
  assert.equal(f.controller.active, true);
  assert.equal(f.content.hasAttribute("inert"), true);
  assert.equal(f.menu.hasAttribute("inert"), false);
  assert.deepEqual(f.pauses, [true]);
  assert.equal(f.controller.boundary(), gate, "overlapping callbacks share one receipt gate");
  await settle();
  assert.equal(f.overlay(), null, "presentation waits for the journal acknowledgement");
  confirm(true);
  await settle();
  assert.deepEqual(f.claims, ["set-1"]);
  assert.equal(f.overlay().hidden, false);
  assert.equal(f.overlay().querySelectorAll(".caatuu-practice-reward").length, 3);
  assert.match(f.overlay().textContent, /\+16XP\+1Coins\+1Gems/u);
  assert.equal(f.document.activeElement, f.skip());
  await f.advance(60000);
  assert.equal(f.controller.active, true);
  assert.equal(completed, false, "elapsed animation time does not release the next challenge");
  assert.equal(f.overlay().hidden, false);
  assert.equal(f.content.hasAttribute("inert"), true);
  assert.deepEqual(f.pauses, [true]);
  assert.deepEqual(f.claims, ["set-1"], "waiting does not claim the reward again");
  f.skip().click();
  assert.equal(await gate, true);
  assert.equal(f.content.hasAttribute("inert"), false);
  assert.deepEqual(f.pauses, [true, false]);
  assert.equal(await f.controller.boundary(), false);
  f.controller.destroy();
});

test("Continue and Escape acknowledge without replay and restore meaningful game focus", async () => {
  const f = fixture({ pending: receipt() });
  f.controller.setActive(true);
  f.next.focus();
  const first = f.controller.boundary();
  await settle();
  f.skip().click();
  assert.equal(await first, true);
  assert.equal(f.document.activeElement, f.next);
  assert.equal(await f.controller.boundary(), false);
  f.update({ pending: receipt("set-2") });
  f.content.setAttribute("inert", "");
  const second = f.controller.boundary();
  await settle();
  f.document.dispatchEvent({ type: "keydown", key: "Escape" });
  assert.equal(await second, true);
  assert.equal(f.content.hasAttribute("inert"), true, "preexisting inert state belongs to another controller");
  assert.notEqual(f.document.activeElement, f.next, "do not focus content that remains inert");
  assert.equal(f.timers.size, 0);
  f.controller.destroy();
});

test("Escape from another dialog leaves the reward waiting for its own acknowledgement", async () => {
  const f = fixture({ pending: receipt() });
  f.controller.setActive(true);
  const gate = f.controller.boundary();
  let completed = false;
  void gate.then(() => { completed = true; });
  await settle();
  const otherDialog = f.document.createElement("section");
  otherDialog.setAttribute("role", "dialog");
  const dialogControl = f.document.createElement("button");
  otherDialog.append(dialogControl);
  f.document.body.append(otherDialog);
  dialogControl.focus();
  f.document.dispatchEvent({ type: "keydown", key: "Escape", target: dialogControl });
  await settle();
  assert.equal(completed, false, "closing a menu or settings dialog does not also acknowledge the reward");
  assert.equal(f.controller.active, true);
  assert.equal(f.content.hasAttribute("inert"), true);
  assert.equal(f.document.activeElement, dialogControl);
  otherDialog.remove();
  f.skip().focus();
  f.document.dispatchEvent({ type: "keydown", key: "Escape", target: f.skip() });
  assert.equal(await gate, true, "Escape in the reward dialog remains an explicit acknowledgement");
  assert.equal(f.content.hasAttribute("inert"), false);
  assert.deepEqual(f.claims, ["set-1"]);
  f.controller.destroy();
});

test("Tab navigation can leave the waiting reward while game content remains inert", async () => {
  const f = fixture({ pending: receipt() });
  f.controller.setActive(true);
  f.next.focus();
  const gate = f.controller.boundary();
  let completed = false;
  void gate.then(() => { completed = true; });
  await settle();
  assert.equal(f.document.activeElement, f.skip());
  for (const shiftKey of [false, true]) {
    const event = { type: "keydown", key: "Tab", shiftKey, target: f.skip() };
    f.document.dispatchEvent(event);
    assert.equal(event.defaultPrevented, false, "the browser owns forward and backward focus navigation");
  }
  f.menu.focus();
  await settle();
  assert.equal(f.document.activeElement, f.menu, "chrome controls remain outside the inert game content");
  assert.equal(f.content.hasAttribute("inert"), true);
  assert.equal(f.menu.hasAttribute("inert"), false);
  assert.equal(f.controller.active, true);
  assert.equal(completed, false, "moving focus does not acknowledge the receipt");
  f.skip().click();
  assert.equal(await gate, true);
  assert.equal(f.content.hasAttribute("inert"), false);
  f.controller.destroy();
});

test("reduced motion keeps the static receipt until explicit acknowledgement", async () => {
  const f = fixture({ pending: receipt(), reduced: true });
  f.controller.setActive(true);
  const gate = f.controller.boundary();
  let completed = false;
  void gate.then(() => { completed = true; });
  await settle();
  assert.equal(f.overlay().classList.contains("is-reduced-motion"), true);
  await f.advance(60000);
  assert.equal(f.controller.active, true);
  assert.equal(completed, false);
  assert.equal(f.content.hasAttribute("inert"), true);
  f.skip().click();
  assert.equal(await gate, true);
  assert.deepEqual(f.claims, ["set-1"]);
  f.controller.destroy();
});

test("hidden pages defer presentation and keep the reward waiting after every resume", async () => {
  const f = fixture({ pending: receipt() });
  f.controller.setActive(true);
  f.document.visibilityState = "hidden";
  const gate = f.controller.boundary();
  let completed = false;
  void gate.then(() => { completed = true; });
  await settle();
  assert.equal(f.overlay().hidden, true);
  assert.equal(f.timers.size, 0);
  await f.advance(60000);
  assert.equal(completed, false);
  f.document.visibilityState = "visible";
  f.document.dispatchEvent({ type: "visibilitychange" });
  await f.advance(400);
  f.document.visibilityState = "hidden";
  f.document.dispatchEvent({ type: "visibilitychange" });
  assert.equal(f.overlay().classList.contains("is-paused"), true);
  await f.advance(60000);
  assert.equal(f.controller.active, true);
  f.document.visibilityState = "visible";
  f.document.dispatchEvent({ type: "visibilitychange" });
  await f.advance(60000);
  assert.equal(f.controller.active, true);
  assert.equal(f.overlay().classList.contains("is-paused"), false);
  assert.equal(completed, false);
  assert.equal(f.content.hasAttribute("inert"), true);
  f.skip().click();
  assert.equal(await gate, true);
  f.controller.destroy();
});

test("navigation cancels an unstarted claim and a late claim cannot overlay a different page", async () => {
  let confirm;
  const f = fixture({ pending: receipt(), claim: () => new Promise(resolve => { confirm = resolve; }) });
  f.controller.setActive(true);
  const unstarted = f.controller.boundary();
  f.controller.setActive(false);
  await settle();
  assert.equal(await unstarted, false);
  assert.deepEqual(f.claims, []);
  assert.equal(f.document.querySelector("[data-caatuu-practice-meter]").hidden, true);
  f.controller.setActive(true);
  const started = f.controller.boundary();
  await settle();
  f.controller.setActive(false);
  confirm(true);
  await settle();
  assert.equal(await started, false);
  assert.equal(f.overlay(), null);
  assert.equal(f.content.hasAttribute("inert"), false);
  f.controller.destroy();
});

test("a lost or failed acknowledgement releases the transition without showing a receipt", async () => {
  for (const claim of [async () => false, async () => { throw new Error("journal unavailable"); }]) {
    const f = fixture({ pending: receipt(), claim });
    f.controller.setActive(true);
    assert.equal(await f.controller.boundary(), false);
    assert.equal(f.overlay(), null);
    assert.equal(f.controller.active, false);
    assert.equal(f.content.hasAttribute("inert"), false);
    assert.deepEqual(f.pauses, [true, false]);
    f.controller.destroy();
  }
});

test("initial robot loads leave persisted receipts quiet and later real transitions await them", async () => {
  const f = fixture({ pending: receipt() });
  f.controller.setActive(true);
  const initial = f.transition({ initial: true });
  await settle();
  assert.deepEqual(initial, []);
  assert.equal(f.overlay(), null);
  assert.deepEqual(f.boundaries, ["verb-nebula"]);
  const next = f.transition();
  await settle();
  assert.equal(next.length, 1);
  f.skip().click();
  assert.equal(await next[0], true);
  f.controller.destroy();
});

test("challenge transitions remain gated after the animation until Continue", async () => {
  const f = fixture({ pending: receipt() });
  f.controller.setActive(true);
  const [showGate] = f.transition();
  let released = false;
  void showGate.then(() => { released = true; });
  await settle();
  const [hideGate] = f.transition({ phase: "hide" });
  assert.equal(hideGate, showGate, "show and hide await the same reward acknowledgement");
  await f.advance(60000);
  assert.equal(released, false);
  assert.equal(f.controller.active, true);
  assert.equal(f.content.hasAttribute("inert"), true);
  assert.deepEqual(f.pauses, [true]);
  f.skip().click();
  assert.equal(await showGate, true);
  assert.equal(await hideGate, true);
  assert.equal(f.content.hasAttribute("inert"), false);
  assert.deepEqual(f.pauses, [true, false]);
  assert.deepEqual(f.claims, ["set-1"]);
  f.controller.destroy();
});

test("authentic completion at the first robot transition can flush a live practice set", async () => {
  const f = fixture();
  f.controller.setActive(true);
  f.learning.completePracticeBoundary = gameId => {
    assert.equal(gameId, "verb-nebula");
    f.update({ effort: 0, pending: receipt() }, false);
    f.window.dispatchEvent({ type: "caatuu:practice-boundary", detail: { gameId } });
  };
  const gates = f.transition({ initial: true });
  assert.equal(f.controller.active, true);
  assert.equal(gates.length, 1);
  await settle();
  f.skip().click();
  assert.equal(await gates[0], true);
  f.controller.destroy();
});

test("learning updates are quiet except for late completion during an actual robot transition", async () => {
  const f = fixture();
  f.controller.setActive(true);
  f.update({ effort: 7 });
  assert.equal(f.document.querySelector(".caatuu-practice-meter-progress").getAttribute("aria-valuetext"), "7 / 12");
  f.update({ pending: receipt() });
  await settle();
  assert.equal(f.overlay(), null, "answers by themselves do not interrupt gameplay");
  f.update({ pending: null });
  f.transition({ initial: true });
  f.update({ effort: 0, pending: receipt("set-2") });
  assert.equal(f.controller.active, true);
  const hide = f.transition({ phase: "hide", initial: true });
  assert.equal(hide.length, 1, "loader hide joins a reward that arrived after show");
  const pausedHide = f.transition({ phase: "hide", initial: true, active: false });
  assert.equal(pausedHide[0], hide[0], "the presenter's own gameplay pause must not release the robot early");
  await settle();
  f.skip().click();
  assert.equal(await hide[0], true);
  f.controller.destroy();
});

test("menus keep their focus and destroy releases listeners, meters, and game input", async () => {
  const f = fixture({ pending: receipt() });
  f.controller.setActive(true);
  f.menu.focus();
  const gate = f.controller.boundary();
  await settle();
  assert.equal(f.document.activeElement, f.menu);
  f.controller.destroy();
  assert.equal(await gate, true);
  assert.equal(f.content.hasAttribute("inert"), false);
  assert.equal(f.document.activeElement, f.menu);
  assert.equal(f.document.querySelector("[data-caatuu-practice-meter]").isConnected, false);
  f.update({ pending: receipt("set-2") });
  f.transition();
  await settle();
  assert.deepEqual(f.claims, ["set-1"]);
  assert.equal(f.timers.size, 0);
});

test("reset, page exit, and changing games cancel an in-flight receipt", async () => {
  for (const cancel of [
    f => f.window.dispatchEvent({ type: "caatuu:learning-change", detail: { reason: "progress-reset", practiceSet: null } }),
    f => f.window.dispatchEvent({ type: "pagehide" }),
    f => {
      f.content.hidden = true;
      const other = f.document.createElement("section");
      other.setAttribute("data-train-panel", "word-net");
      f.document.body.append(other);
      f.controller.setActive(true);
    }
  ]) {
    let confirm;
    const f = fixture({ pending: receipt(), claim: () => new Promise(resolve => { confirm = resolve; }) });
    f.controller.setActive(true);
    const gate = f.controller.boundary();
    await settle();
    cancel(f);
    confirm(true);
    await settle();
    assert.equal(await gate, false);
    assert.equal(f.controller.active, false);
    assert.equal(f.overlay(), null);
    assert.equal(f.content.hasAttribute("inert"), false);
    f.controller.destroy();
  }
});

test("cross-tab acknowledgement and reset cancel stale claims, and page restoration stays quiet", async () => {
  for (const key of ["course.practice.v1.pending.ack", "course.performance.v1.reset", null]) {
    let confirm;
    const f = fixture({ pending: receipt(), claim: () => new Promise(resolve => { confirm = resolve; }) });
    f.controller.setActive(true);
    const gate = f.controller.boundary();
    await settle();
    f.update({ pending: null, effort: 0 }, false);
    f.window.dispatchEvent({ type: "storage", key });
    confirm(true);
    await settle();
    assert.equal(await gate, false);
    assert.equal(f.overlay(), null);
    assert.equal(f.content.hasAttribute("inert"), false);
    f.update({ pending: receipt("restored-set"), effort: 2 }, false);
    f.window.dispatchEvent({ type: "pageshow" });
    await settle();
    assert.equal(f.document.querySelector(".caatuu-practice-meter-progress").getAttribute("aria-valuetext"), "2 / 12");
    assert.equal(f.overlay(), null);
    assert.deepEqual(f.claims, ["set-1"]);
    f.controller.destroy();
  }
});
