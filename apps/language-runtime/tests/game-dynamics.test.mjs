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
  f.skip().dispatchEvent({ type: "click" });
  assert.equal(await gate, true);
  const afterSkip = stops;
  f.controller.destroy();
  assert.equal(destroyed, 1);
  assert.ok(afterSkip >= 2);
});

test("reward flights target the real header counters and pause/cancel with their receipt", async () => {
  const f = fixture({ pending: { ...receipt(), gems: 1 } });
  const animations = [];
  const create = f.document.createElement;
  f.document.createElement = tag => {
    const node = create(tag);
    node.animate = (frames, options) => {
      const animation = { frames, options, plays: 0, pauses: 0, cancels: 0,
        play() { this.plays++; }, pause() { this.pauses++; }, cancel() { this.cancels++; } };
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
  assert.ok(animations.every(animation => animation.plays === 2));
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
  let snapshot = { target: 12, effort: 4, completedSets: 0, pending, coins: 0, gems: 0 };
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
  await f.advance(2199);
  assert.equal(f.controller.active, true);
  await f.advance(1);
  assert.equal(await gate, true);
  assert.equal(f.content.hasAttribute("inert"), false);
  assert.deepEqual(f.pauses, [true, false]);
  assert.equal(await f.controller.boundary(), false);
  f.controller.destroy();
});

test("skip and Escape acknowledge without replay and restore meaningful game focus", async () => {
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

test("reduced motion presents a short static receipt with the same idempotent acknowledgement", async () => {
  const f = fixture({ pending: receipt(), reduced: true });
  f.controller.setActive(true);
  const gate = f.controller.boundary();
  await settle();
  assert.equal(f.overlay().classList.contains("is-reduced-motion"), true);
  await f.advance(1199);
  assert.equal(f.controller.active, true);
  await f.advance(1);
  assert.equal(await gate, true);
  assert.deepEqual(f.claims, ["set-1"]);
  f.controller.destroy();
});

test("hidden pages wait to present and pause the remaining celebration time", async () => {
  const f = fixture({ pending: receipt() });
  f.controller.setActive(true);
  f.document.visibilityState = "hidden";
  const gate = f.controller.boundary();
  await settle();
  assert.equal(f.overlay().hidden, true);
  assert.equal(f.timers.size, 0);
  await f.advance(5000);
  f.document.visibilityState = "visible";
  f.document.dispatchEvent({ type: "visibilitychange" });
  await f.advance(400);
  f.document.visibilityState = "hidden";
  f.document.dispatchEvent({ type: "visibilitychange" });
  assert.equal(f.overlay().classList.contains("is-paused"), true);
  await f.advance(5000);
  assert.equal(f.controller.active, true);
  f.document.visibilityState = "visible";
  f.document.dispatchEvent({ type: "visibilitychange" });
  await f.advance(1799);
  assert.equal(f.controller.active, true);
  await f.advance(1);
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
  assert.equal(f.document.querySelector(".caatuu-practice-meter-count").textContent, "7 / 12");
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
    assert.equal(f.document.querySelector(".caatuu-practice-meter-count").textContent, "2 / 12");
    assert.equal(f.overlay(), null);
    assert.deepEqual(f.claims, ["set-1"]);
    f.controller.destroy();
  }
});
