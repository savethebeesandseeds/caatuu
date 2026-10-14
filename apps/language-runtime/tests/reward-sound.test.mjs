import assert from "node:assert/strict";
import test from "node:test";
import { createRewardSound } from "../static/source/reward-sound.mjs";

class Events {
  listeners = new Map();
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  dispatch(type, detail) { for (const listener of this.listeners.get(type) || []) listener({ type, detail }); }
  listenerCount() { return [...this.listeners.values()].reduce((count, entries) => count + entries.size, 0); }
}
class Parameter {
  value = 1;
  changes = [];
  cancelScheduledValues(time) { this.changes.push(["cancel", time]); }
  setValueAtTime(value, time) { this.value = value; this.changes.push(["set", value, time]); }
  linearRampToValueAtTime(value, time) { this.changes.push(["linear", value, time]); }
  exponentialRampToValueAtTime(value, time) { this.changes.push(["exponential", value, time]); }
}
class Node {
  connections = [];
  disconnected = false;
  connect(destination) { this.connections.push(destination); }
  disconnect() { this.disconnected = true; }
}
class Oscillator extends Node {
  frequency = new Parameter();
  starts = [];
  stops = [];
  start(time) { this.starts.push(time); }
  stop(time) { this.stops.push(time); }
  end() { this.onended?.(); }
}
const gesture = (type = "pointerdown", isTrusted = true) => ({ type, isTrusted });
const receipt = { id: "set-1", xp: 16, coins: 1, gems: 0 };
const settle = async () => { for (let count = 0; count < 8; count++) await Promise.resolve(); };

function fixture({ state = "running", resume, nativeFocused = true, music = true } = {}) {
  const scope = new Events();
  const document = new Events();
  scope.document = document;
  document.visibilityState = "visible";
  document.focused = true;
  document.hasFocus = () => document.focused;
  scope.CaatuuAndroid = { isAppFocused: () => nativeFocused };
  // Voice mute is deliberately irrelevant to effects, even with volume zero.
  scope.CaatuuChrome = { getSpeechVolume: () => 0, getSpeechMuted: () => true };
  const contexts = [];
  scope.AudioContext = class {
    constructor() { contexts.push(this); this.state = state; }
    currentTime = 10;
    destination = {};
    oscillators = [];
    gains = [];
    resumes = 0;
    closes = 0;
    createGain() { const gain = new Node(); gain.gain = new Parameter(); this.gains.push(gain); return gain; }
    createOscillator() { const oscillator = new Oscillator(); this.oscillators.push(oscillator); return oscillator; }
    resume() { this.resumes++; if (resume) return resume(this); this.state = "running"; return Promise.resolve(); }
    close() { this.closes++; this.state = "closed"; return Promise.resolve(); }
  };
  const listeners = new Set();
  let preferences = { volume: 0.5, masterMuted: false };
  const player = {
    getState: () => preferences,
    subscribe(callback) { listeners.add(callback); callback(preferences); return () => listeners.delete(callback); }
  };
  if (music) scope.CaatuuMusic = player;
  const update = changes => { preferences = { ...preferences, ...changes }; for (const listener of listeners) listener(preferences); };
  return { scope, document, contexts, player, listeners, update, context: () => contexts[0] };
}

test("only a trusted pointer or key gesture creates an audio context; installation and rewards never unlock it", () => {
  const f = fixture();
  const sound = createRewardSound({ scope: f.scope });
  assert.equal(sound.play(receipt), false);
  for (const event of [undefined, gesture("pointerdown", false), gesture("keydown", false), gesture("focus"), gesture("click")]) {
    assert.equal(sound.unlock(event), false);
  }
  assert.equal(f.contexts.length, 0);
  assert.equal(sound.unlock(gesture("keydown")), true);
  assert.equal(sound.unlock(gesture()), true);
  assert.equal(f.contexts.length, 1);
  assert.equal(f.context().oscillators.length, 0);
  sound.destroy();
});

test("touch release retries a suspended context after a non-activating touch press", () => {
  let activated = false;
  const f = fixture({ state: "suspended", resume: context => {
    if (activated) context.state = "running";
    return Promise.resolve();
  } });
  const sound = createRewardSound({ scope: f.scope });
  sound.unlock({ ...gesture(), pointerType: "touch" });
  assert.equal(sound.play(receipt), false);
  activated = true;
  assert.equal(sound.unlock({ ...gesture("pointerup"), pointerType: "touch" }), true);
  assert.equal(f.context().resumes, 2);
  assert.equal(sound.play(receipt), true);
  sound.destroy();
});

test("a reward plays a short ascending chime and coin ticks at shared volume despite voice mute", () => {
  const f = fixture();
  const sound = createRewardSound({ scope: f.scope });
  sound.unlock(gesture());
  assert.equal(sound.play(receipt), true);
  const context = f.context();
  assert.equal(context.gains[0].gain.value, 0.1);
  assert.equal(context.oscillators.length, 5);
  assert.deepEqual(context.oscillators.slice(0, 3).map(node => node.frequency.value), [523.25, 659.25, 783.99]);
  assert.ok(context.oscillators.every(node => node.starts.length === 1 && node.stops[0] - context.currentTime < 0.8));
  assert.equal(context.oscillators[3].type, "triangle");
  sound.destroy();
});

test("gems add a distinct soft sparkle while XP alone has no coin ticks", () => {
  const f = fixture();
  const sound = createRewardSound({ scope: f.scope });
  sound.unlock(gesture());
  sound.play({ xp: 2 });
  assert.equal(f.context().oscillators.length, 3);
  sound.play({ ...receipt, gems: 1 });
  assert.equal(f.context().oscillators.length, 11);
  const sparkle = f.context().oscillators.slice(-3);
  assert.deepEqual(sparkle.map(node => node.frequency.value), [1046.5, 1567.98, 2093]);
  assert.ok(sparkle.every(node => node.stops[0] - f.context().currentTime < 1.2));
  sound.destroy();
});

test("changing shared volume applies immediately; master mute and zero volume cancel scheduled notes", () => {
  const f = fixture();
  const sound = createRewardSound({ scope: f.scope });
  sound.unlock(gesture());
  sound.play(receipt);
  f.update({ volume: 0.75 });
  assert.ok(Math.abs(f.context().gains[0].gain.value - 0.316227766) < 1e-9);
  assert.ok(f.context().oscillators.every(node => !node.disconnected));
  f.update({ masterMuted: true });
  assert.ok(f.context().oscillators.every(node => node.disconnected));
  assert.equal(sound.play(receipt), false);
  f.update({ masterMuted: false });
  assert.equal(sound.play(receipt), true);
  f.update({ volume: 0 });
  assert.ok(f.context().oscillators.every(node => node.disconnected));
  assert.equal(sound.play(receipt), false);
  assert.equal(f.context().gains[0].gain.value, 0);
  sound.destroy();
});

test("a rejected autoplay resume silently skips sounds without prompting or throwing", async () => {
  const f = fixture({ state: "suspended", resume: () => Promise.reject(Object.assign(new Error(), { name: "NotAllowedError" })) });
  const sound = createRewardSound({ scope: f.scope });
  assert.equal(sound.unlock(gesture()), true);
  assert.equal(sound.play(receipt), false);
  await settle();
  assert.equal(f.context().oscillators.length, 0);
  assert.equal(f.context().resumes, 1);
  sound.destroy();
});

test("a late successful resume does not replay the reward that was skipped while blocked", async () => {
  let ready;
  const f = fixture({ state: "suspended", resume: context => new Promise(resolve => {
    ready = () => { context.state = "running"; resolve(); };
  }) });
  const sound = createRewardSound({ scope: f.scope });
  sound.unlock(gesture());
  assert.equal(sound.play(receipt), false);
  ready();
  await settle();
  assert.equal(f.context().oscillators.length, 0);
  assert.equal(sound.play(receipt), true);
  sound.destroy();
});

test("visibility, page lifecycle and native focus stop sound and never restart a cancelled cue", () => {
  const f = fixture();
  const sound = createRewardSound({ scope: f.scope });
  sound.unlock(gesture());
  sound.play(receipt);
  f.document.visibilityState = "hidden";
  f.document.dispatch("visibilitychange");
  assert.ok(f.context().oscillators.every(node => node.disconnected));
  assert.equal(sound.play(receipt), false);
  f.document.visibilityState = "visible";
  f.document.dispatch("visibilitychange");
  assert.equal(f.context().oscillators.length, 5);
  sound.play(receipt);
  f.scope.dispatch("pagehide");
  assert.equal(sound.play(receipt), false);
  f.scope.dispatch("pageshow");
  assert.equal(f.context().oscillators.length, 10);
  sound.play(receipt);
  f.scope.dispatch("caatuu:app-focus-change", { focused: false });
  assert.ok(f.context().oscillators.every(node => node.disconnected));
  assert.equal(sound.play(receipt), false);
  f.scope.dispatch("caatuu:app-focus-change", { focused: true });
  assert.equal(f.context().oscillators.length, 15);
  sound.destroy();
});

test("window blur respects focus moving into a game frame but cancels sound after actual focus loss", async () => {
  const f = fixture();
  const sound = createRewardSound({ scope: f.scope });
  sound.unlock(gesture());
  sound.play(receipt);
  f.scope.dispatch("blur");
  await settle();
  assert.ok(f.context().oscillators.every(node => !node.disconnected));
  f.document.focused = false;
  f.scope.dispatch("blur");
  await settle();
  assert.ok(f.context().oscillators.every(node => node.disconnected));
  assert.equal(sound.play(receipt), false);
  sound.destroy();
});

test("stop and replacement detach every oscillator and envelope; ended notes release themselves", () => {
  const f = fixture();
  const sound = createRewardSound({ scope: f.scope });
  sound.unlock(gesture());
  sound.play(receipt);
  const context = f.context();
  context.oscillators[0].end();
  assert.equal(context.oscillators[0].disconnected, true);
  assert.equal(context.gains[1].disconnected, true);
  assert.equal(context.oscillators[0].onended, null);
  sound.stop();
  sound.stop();
  assert.ok(context.oscillators.every(node => node.disconnected));
  assert.ok(context.gains.slice(1).every(node => node.disconnected));
  assert.ok(context.oscillators.every(node => node.stops.length <= 2));
  sound.play(receipt);
  sound.play(receipt);
  assert.ok(context.oscillators.slice(0, -5).every(node => node.disconnected));
  sound.destroy();
});

test("destroy closes the context, unsubscribes preferences, removes all lifecycle listeners and remains inert", async () => {
  const f = fixture();
  const sound = createRewardSound({ scope: f.scope });
  sound.unlock(gesture());
  sound.play(receipt);
  assert.equal(f.listeners.size, 1);
  sound.destroy();
  sound.destroy();
  await settle();
  assert.equal(f.context().closes, 1);
  assert.ok(f.context().gains.every(node => node.disconnected));
  assert.ok(f.context().oscillators.every(node => node.disconnected));
  assert.equal(f.listeners.size, 0);
  assert.equal(f.scope.listenerCount(), 0);
  assert.equal(f.document.listenerCount(), 0);
  assert.equal(sound.unlock(gesture()), false);
  assert.equal(sound.play(receipt), false);
});

test("shared preferences installed after the reward controller are picked up on unlock", () => {
  const f = fixture({ music: false });
  const sound = createRewardSound({ scope: f.scope });
  f.scope.CaatuuMusic = f.player;
  f.update({ volume: 0 });
  sound.unlock(gesture());
  assert.equal(sound.play(receipt), false);
  f.update({ volume: 0.5 });
  assert.equal(sound.play(receipt), true);
  sound.destroy();
});

test("custom effect preferences remain independent of both voice and music controls", () => {
  const f = fixture();
  let preferences = { volume: 0.75, muted: false };
  const sound = createRewardSound({ scope: f.scope, getPreferences: () => preferences });
  f.update({ volume: 0, masterMuted: true });
  sound.unlock(gesture());
  assert.equal(sound.play(receipt), true);
  assert.ok(Math.abs(f.context().gains[0].gain.value - 0.316227766) < 1e-9);
  preferences = { volume: 0.75, muted: true };
  f.scope.dispatch("caatuu:reward-audio-change");
  assert.ok(f.context().oscillators.every(node => node.disconnected));
  assert.equal(sound.play(receipt), false);
  sound.destroy();
});

test("missing Web Audio, hidden gestures, empty receipts and native focus loss quietly omit audio", () => {
  const missing = fixture();
  delete missing.scope.AudioContext;
  const absent = createRewardSound({ scope: missing.scope });
  assert.equal(absent.unlock(gesture()), false);
  assert.equal(absent.play(receipt), false);
  absent.destroy();
  const f = fixture();
  const sound = createRewardSound({ scope: f.scope });
  f.document.visibilityState = "hidden";
  assert.equal(sound.unlock(gesture()), false);
  assert.equal(f.contexts.length, 0);
  f.document.visibilityState = "visible";
  sound.unlock(gesture());
  for (const value of [null, undefined, {}, { xp: 0, coins: -1, gems: 0 }]) assert.equal(sound.play(value), false);
  assert.equal(f.context().oscillators.length, 0);
  sound.destroy();
  const native = fixture({ nativeFocused: false });
  const nativeSound = createRewardSound({ scope: native.scope });
  assert.equal(nativeSound.unlock(gesture()), false);
  nativeSound.destroy();
});

test("partially failed context setup closes its resources and a subsequent gesture can recover", () => {
  const f = fixture();
  const Context = f.scope.AudioContext;
  f.scope.AudioContext = class extends Context {
    createGain() { throw new Error("Audio output unavailable"); }
  };
  const sound = createRewardSound({ scope: f.scope });
  assert.equal(sound.unlock(gesture()), false);
  assert.equal(f.context().closes, 1);
  f.scope.AudioContext = Context;
  assert.equal(sound.unlock(gesture()), true);
  assert.equal(f.contexts.length, 2);
  assert.equal(sound.play(receipt), true);
  sound.destroy();
});

test("failed note construction stops and disconnects already created sources", () => {
  const f = fixture();
  const sound = createRewardSound({ scope: f.scope });
  sound.unlock(gesture());
  f.context().createGain = () => { throw new Error("Audio source unavailable"); };
  assert.equal(sound.play(receipt), false);
  assert.equal(f.context().oscillators.length, 1);
  assert.equal(f.context().oscillators[0].disconnected, true);
  assert.equal(f.context().oscillators[0].stops.length, 1);
  sound.destroy();
});
