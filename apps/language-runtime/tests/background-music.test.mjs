import assert from "node:assert/strict";
import test from "node:test";
import { installMusicPlayer, MUSIC_TRACKS } from "../static/source/background-music.mjs";

class Events {
  listeners = new Map();
  addEventListener(name, callback) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(callback);
  }
  removeEventListener(name, callback) { this.listeners.get(name)?.delete(callback); }
  dispatch(name, detail) { for (const callback of this.listeners.get(name) || []) callback({ type: name, detail }); }
}
class Audio extends Events {
  paused = true;
  currentTime = 0;
  duration = 120;
  plays = 0;
  loads = 0;
  src = "";
  playResult = null;
  load() { this.loads++; this.currentTime = 0; }
  play() {
    this.plays++;
    if (this.playResult) return this.playResult();
    this.paused = false;
    this.dispatch("playing");
    return Promise.resolve();
  }
  pause() { if (!this.paused) { this.paused = true; this.dispatch("pause"); } }
  removeAttribute(name) { if (name === "src") this.src = ""; }
}
const storage = (initial = []) => {
  const values = new Map(initial);
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
};
function fixture({ native = false, nativeFocused = true, appReady = false, setupBlocked = false, localStorage = storage(), sessionStorage = storage() } = {}) {
  const scope = new Events();
  scope.top = scope;
  scope.localStorage = localStorage;
  scope.sessionStorage = sessionStorage;
  const audio = new Audio();
  const document = new Events();
  document.visibilityState = "visible";
  document.focused = true;
  document.hasFocus = () => document.focused;
  document.documentElement = { dataset: { caatuuAppReady: appReady ? "true" : "false" } };
  document.body = { blocked: setupBlocked, classList: { contains: () => document.body.blocked } };
  document.createElement = (tag) => { assert.equal(tag, "audio"); return audio; };
  document.querySelectorAll = () => [];
  scope.document = document;
  scope.speechSynthesis = { volume: 0.9, speaking: false };
  const cached = new Map();
  scope.caches = { open: async (name) => {
    assert.equal(name, "caatuu-music-v1");
    return { match: async (url) => cached.get(url) };
  } };
  const revoked = [];
  let blobSequence = 0;
  scope.URL = { createObjectURL: () => `blob:music-${++blobSequence}`, revokeObjectURL: (url) => revoked.push(url) };
  if (native) scope.CaatuuAndroid = { postMessage() {}, isAppFocused: () => nativeFocused };
  scope.MutationObserver = class {
    constructor(callback) { scope.mutate = callback; }
    observe() {}
    disconnect() {}
  };
  const cacheTracks = () => {
    for (const track of MUSIC_TRACKS) cached.set(track.url, {
      ok: true, headers: { get: () => track.sha256 }, blob: async () => new Blob([track.id], { type: "audio/mpeg" }),
    });
  };
  return { scope, document, audio, cached, cacheTracks, revoked };
}
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

test("defaults to Woodland Fantasy at ten percent and never fetches uninstalled music", async () => {
  const f = fixture();
  f.scope.fetch = () => assert.fail("Music cannot download itself.");
  const music = installMusicPlayer(f.scope);
  await settle();
  assert.equal(music.getState().trackId, "woodland-fantasy");
  assert.equal(music.getState().volume, 0.1);
  assert.equal(music.getState().ready, false);
  assert.equal(f.audio.plays, 0);
  assert.equal(f.audio.src, "");
});

test("requires every pinned cache artifact, then loops cache bytes without a service worker", async () => {
  const f = fixture();
  f.cacheTracks();
  f.cached.get(MUSIC_TRACKS[1].url).headers.get = () => "wrong-hash";
  const music = installMusicPlayer(f.scope);
  await settle();
  assert.equal(music.getState().ready, false);
  f.cacheTracks();
  f.scope.dispatch("caatuu:music-assets-ready");
  await settle();
  assert.equal(music.getState().ready, true);
  assert.equal(music.getState().playing, true);
  assert.equal(f.audio.src, "blob:music-1");
  assert.equal(f.audio.loop, true);
});

test("music volume follows a decibel taper with exact silence and full gain", () => {
  const f = fixture();
  const music = installMusicPlayer(f.scope);
  for (const [position, gain] of [[0, 0], [0.25, 0.0316227766], [0.5, 0.1], [0.75, 0.3162277660], [1, 1]]) {
    music.setVolume(position);
    assert.ok(Math.abs(f.audio.volume - gain) < 1e-9, `music gain at ${position * 100}%`);
    assert.equal(music.getState().volume, position);
    assert.equal(JSON.parse(f.scope.localStorage.getItem("caatuu.music.v1")).volume, position);
  }
  music.setVolume(0.5);
  const restored = fixture({ localStorage: f.scope.localStorage });
  installMusicPlayer(restored.scope);
  assert.equal(restored.audio.volume, 0.1);
  assert.equal(f.scope.speechSynthesis.volume, 0.9);
});

test("top and embedded games share a single player and iframe gestures retry autoplay", async () => {
  const f = fixture();
  const music = installMusicPlayer(f.scope);
  f.audio.playResult = () => Promise.reject(Object.assign(new Error("Gesture needed"), { name: "NotAllowedError" }));
  music.setReady(true);
  await settle();
  assert.equal(music.getState().blocked, true);
  const child = new Events();
  child.top = f.scope;
  child.document = new Events();
  assert.equal(installMusicPlayer(child), music);
  assert.equal(installMusicPlayer(f.scope), music);
  f.audio.playResult = null;
  child.document.dispatch("pointerdown");
  await settle();
  assert.equal(music.getState().blocked, false);
  assert.equal(music.getState().playing, true);
  assert.equal(f.audio.plays, 2);
  f.scope.dispatch("blur"); // Into the child: document still has focus.
  await settle();
  assert.equal(music.getState().playing, true);
  assert.equal(f.audio.plays, 2);
});

test("iframe navigation registers activation on the replacement document", async () => {
  const f = fixture();
  const child = new Events();
  child.top = f.scope;
  child.document = new Events();
  f.document.querySelectorAll = () => [{ contentWindow: child }];
  const music = installMusicPlayer(f.scope);
  f.audio.playResult = () => Promise.reject(Object.assign(new Error("Gesture needed"), { name: "NotAllowedError" }));
  music.setReady(true);
  await settle();
  assert.equal(music.getState().blocked, true);
  child.document = new Events(); // Same WindowProxy after about:blank navigates to a game.
  f.document.dispatch("load");
  f.audio.playResult = null;
  child.document.dispatch("pointerdown");
  await settle();
  assert.equal(music.getState().playing, true);
  assert.equal(f.audio.plays, 2);
});

test("blur, visibility, page lifecycle and native focus pause and resume the same position", async () => {
  const f = fixture({ native: true, nativeFocused: false, appReady: true });
  const music = installMusicPlayer(f.scope);
  await settle();
  assert.equal(music.getState().playing, false);
  f.scope.dispatch("caatuu:app-focus-change", { focused: true });
  await settle();
  assert.equal(music.getState().playing, true);
  f.audio.currentTime = 33;
  for (const [stop, resume] of [
    [() => { f.document.focused = false; f.scope.dispatch("blur"); }, () => { f.document.focused = true; f.scope.dispatch("focus"); }],
    [() => { f.document.visibilityState = "hidden"; f.document.dispatch("visibilitychange"); }, () => { f.document.visibilityState = "visible"; f.document.dispatch("visibilitychange"); }],
    [() => f.scope.dispatch("pagehide"), () => f.scope.dispatch("pageshow")],
    [() => f.scope.dispatch("caatuu:app-focus-change", { focused: false }), () => f.scope.dispatch("caatuu:app-focus-change", { focused: true })],
  ]) {
    stop(); await settle();
    assert.equal(f.audio.paused, true);
    assert.equal(f.audio.currentTime, 33);
    resume(); await settle();
    assert.equal(music.getState().playing, true);
    assert.equal(f.audio.currentTime, 33);
  }
  assert.equal(f.audio.loads, 1);
});

test("native shell readiness cannot bypass setup; class updates do not create notification loops", async () => {
  const f = fixture({ native: true, appReady: true, setupBlocked: true });
  const music = installMusicPlayer(f.scope);
  let changes = 0;
  music.subscribe(() => changes++);
  assert.equal(music.getState().ready, false);
  f.document.body.blocked = false;
  f.scope.mutate();
  await settle();
  assert.equal(music.getState().ready, true);
  const before = changes;
  f.scope.mutate();
  await settle();
  assert.equal(changes, before);
  f.document.body.blocked = true;
  f.scope.mutate();
  assert.equal(f.audio.paused, true);
});

test("a late successful autoplay attempt cannot restart audio after focus loss", async () => {
  const f = fixture();
  let complete;
  f.audio.playResult = () => new Promise((resolve) => { complete = () => { f.audio.paused = false; resolve(); }; });
  const music = installMusicPlayer(f.scope);
  music.setReady(true);
  f.document.focused = false;
  f.scope.dispatch("blur");
  await settle();
  complete();
  await settle();
  assert.equal(f.audio.paused, true);
  assert.equal(music.getState().playing, false);
});

test("music volume and song persist globally and speech plays independently at its own volume", async () => {
  const f = fixture();
  const music = installMusicPlayer(f.scope);
  music.setReady(true);
  await settle();
  const initialPlays = f.audio.plays;
  f.scope.speechSynthesis.speaking = true;
  assert.equal(music.setVolume(0.22), 0.22);
  f.scope.dispatch("caatuu:speech-pace-change", { rate: 0.8 });
  assert.equal(f.scope.speechSynthesis.volume, 0.9);
  assert.equal(f.audio.plays, initialPlays);
  assert.equal(music.getState().playing, true);
  assert.equal(music.setTrack("town-theme-rpg"), "town-theme-rpg");
  assert.equal(music.setTrack("unknown"), "town-theme-rpg");
  assert.equal(f.audio.currentTime, 0);
  await settle();
  music.setMasterMuted(true);
  assert.equal(music.getState().playing, false);
  assert.equal(music.getState().volume, 0.22);
  music.setMasterMuted(false);
  await settle();
  assert.equal(music.getState().playing, true);
  music.destroy();
  const f2 = fixture({ localStorage: f.scope.localStorage });
  const restored = installMusicPlayer(f2.scope);
  assert.equal(restored.getState().trackId, "town-theme-rpg");
  assert.equal(restored.getState().volume, 0.22);
});

test("silence preserves the chosen track and restores page navigation position", async () => {
  const f = fixture();
  const music = installMusicPlayer(f.scope);
  music.setReady(true);
  await settle();
  f.audio.currentTime = 42;
  music.setVolume(0);
  assert.equal(music.getState().playing, false);
  assert.equal(f.scope.speechSynthesis.volume, 0.9);
  music.setVolume(0.1);
  f.scope.dispatch("pagehide");
  music.destroy();
  const f2 = fixture({ sessionStorage: f.scope.sessionStorage });
  installMusicPlayer(f2.scope).setReady(true);
  f2.audio.dispatch("loadedmetadata");
  assert.equal(f2.audio.currentTime, 42);
});

test("clearing setup cache revokes downloaded music and preserves user preferences", async () => {
  const f = fixture();
  f.cacheTracks();
  const music = installMusicPlayer(f.scope);
  await settle();
  music.setVolume(0.17);
  f.cached.clear();
  f.scope.dispatch("caatuu:music-assets-cleared");
  await settle();
  assert.equal(music.getState().ready, false);
  assert.equal(f.audio.src, "");
  assert.equal(f.revoked.length, 3);
  assert.equal(music.getState().volume, 0.17);
  f.scope.document.dispatch("pointerdown");
  await settle();
  assert.equal(music.getState().ready, false);
  music.destroy();
  assert.equal(f.scope.CaatuuMusic, undefined);
});

test("corrupt preferences and storage failures remain usable", () => {
  const f = fixture({ localStorage: { getItem() { throw new Error("Private mode"); }, setItem() { throw new Error("Private mode"); } } });
  Object.defineProperty(f.scope, "sessionStorage", { get() { throw new Error("Storage getter is blocked"); } });
  const music = installMusicPlayer(f.scope);
  assert.equal(music.getState().volume, 0.1);
  assert.equal(music.setVolume(NaN), 0.1);
  assert.equal(music.setVolume(5), 1);
  assert.equal(music.setVolume(-5), 0);
  assert.equal(music.setTrack("salt-marsh-birds"), "salt-marsh-birds");
});

test("voice mute and volume preferences never silence or alter music", async () => {
  const f = fixture({ localStorage: storage([["caatuu.speech.muted.v1", "true"]]) });
  const music = installMusicPlayer(f.scope);
  music.setReady(true);
  await settle();
  assert.equal(music.getState().playing, true);
  assert.equal(music.getState().masterMuted, false);
  const plays = f.audio.plays;
  for (const callback of f.scope.listeners.get("caatuu:speech-mute-change") || []) callback({ detail: { muted: true } });
  assert.equal(music.getState().playing, true, "voice mute events must leave music playing");
  f.scope.localStorage.setItem("caatuu.speech.muted.v1", "false");
  for (const callback of f.scope.listeners.get("storage")) callback({ key: "caatuu.speech.muted.v1" });
  f.scope.localStorage.setItem("caatuu.speech.volume.v1", "0");
  for (const callback of f.scope.listeners.get("storage")) callback({ key: "caatuu.speech.volume.v1" });
  await settle();
  assert.equal(music.getState().playing, true);
  assert.equal(music.getState().volume, 0.1);
  assert.equal(f.audio.plays, plays, "voice changes must not restart the music");
});

test("standalone native game verifies setup through the existing runtime before playing", async () => {
  const f = fixture({ native: true });
  f.document.documentElement.dataset.caatuuLegacyPageReady = "true";
  let verified = false;
  f.scope.CaatuuRuntime = { setup: { status: async () => ({ ready: verified }) } };
  const music = installMusicPlayer(f.scope);
  await settle();
  assert.equal(music.getState().ready, false);
  assert.equal(f.audio.plays, 0);
  verified = true;
  f.scope.mutate();
  await settle();
  assert.equal(music.getState().ready, true);
  assert.equal(music.getState().playing, true);
});

test("native shared music keeps playing while another course needs setup", async () => {
  const f = fixture({ native: true, appReady: false, setupBlocked: true });
  let sharedReady = false;
  f.scope.CaatuuAndroid.isMusicReady = () => sharedReady;
  const music = installMusicPlayer(f.scope);
  await settle();
  assert.equal(music.getState().ready, false);
  assert.equal(f.audio.plays, 0);
  sharedReady = true; // Another course owns every verified track.
  f.scope.mutate();
  await settle();
  assert.equal(music.getState().ready, true);
  assert.equal(music.getState().playing, true);
  f.audio.currentTime = 23;
  f.scope.mutate();
  assert.equal(f.audio.currentTime, 23);
  assert.equal(f.audio.plays, 1);
  sharedReady = false; // The last installed owner was removed.
  f.scope.mutate();
  assert.equal(music.getState().ready, false);
  assert.equal(f.audio.paused, true);
});
