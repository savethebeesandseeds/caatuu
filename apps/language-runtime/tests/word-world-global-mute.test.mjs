import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../static/source/product-word-world.mjs", import.meta.url), "utf8");
const functions = ["speechGloballyMuted", "syncSpeechControl", "toggleCzechSpeech", "maybeAutoplayCurrentSentence", "refreshAndroidSpeechStatus", "resumeSpeechControl", "initializeSpeechControl"];
const implementation = functions.map((name) => {
  let start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} exists`);
  if (source.slice(start - 6, start) === "async ") start -= 6;
  return source.slice(start, source.indexOf("\n}", start) + 2);
}).join("\n");

function fixture({ native = false } = {}) {
  const button = () => ({
    dataset: {}, attributes: {}, disabled: false,
    classList: { toggle() {} },
    setAttribute(name, value) { this.attributes[name] = value; },
    querySelector() { return { toggleAttribute() {} }; }
  });
  const sentence = button();
  const word = button();
  const listeners = new Map();
  const state = {
    currentSentence: "我在这里。", selectedWord: "我", translationMode: "hover",
    busy: false, speechState: "idle", speechSession: null, audioAutoplay: true,
    lastAutoplayFingerprint: "", pendingSpeechAutoplayFingerprint: "",
    loadingActive: true, loadingPageHidden: false,
    nativeSpeechAvailable: false, nativeSpeechStatusPending: false, nativeSpeechStatusRequestId: 0
  };
  const counters = { spoken: 0, cancelled: 0, status: 0 };
  const nativeStatusRequests = [];
  const nativeSpeech = native ? {
    status() {
      counters.status += 1;
      return new Promise((resolve, reject) => nativeStatusRequests.push({ resolve, reject }));
    }
  } : null;
  let muted = false;
  let supported = true;
  const context = {
    state,
    document: { visibilityState: "visible" },
    window: {
      CaatuuChrome: { getSpeechMuted: () => muted },
      addEventListener: (name, callback) => listeners.set(name, callback)
    },
    $: (selector) => selector === "#wordNetPhraseSound" ? sentence : selector === "#wordNetSelectedWordSound" ? word : null,
    czechSpeechPace: () => ({ label: "normal", source: "override", rate: 1 }),
    speechPaceLabel: () => "Normal",
    interfaceText: (key) => key,
    targetLanguageLabel: "Chinese",
    targetSpeechLocale: "zh-CN",
    preferredSpeechVoice: () => "",
    speechControlSupported: () => native ? state.nativeSpeechAvailable : supported,
    androidSpeechRuntime: () => nativeSpeech,
    browserSpeechSynthesisSupported: () => false,
    normalizeWord: (value) => String(value || "").trim(),
    sentenceFingerprint: (value) => value,
    syncAudioSettingsControl() {},
    unavailableSpeechLabel: () => "unavailable",
    unavailableSpeechTitle: () => "unavailable",
    targetSentenceSpeechAllowed: () => true,
    cancelCzechSpeech() {
      counters.cancelled += 1;
      state.speechSession = null;
      state.speechState = "idle";
    },
    speakCzechWithSharedService() { counters.spoken += 1; return true; }
  };
  vm.createContext(context);
  vm.runInContext(implementation, context);
  context.initializeSpeechControl();
  return {
    context, sentence, word, state, counters,
    async finishNativeStatus(status = { available: true }) {
      nativeStatusRequests.shift().resolve(status);
      await new Promise((resolve) => setImmediate(resolve));
    },
    async failNativeStatus() {
      nativeStatusRequests.shift().reject(new Error("Android voice initialization timed out."));
      await new Promise((resolve) => setImmediate(resolve));
    },
    setSupported(value) { supported = value; },
    setMuted(value) {
      muted = value;
      listeners.get("caatuu:speech-mute-change")();
    }
  };
}

test("global mute disables both Word World playback buttons and unmutes without autoplay", () => {
  const game = fixture();
  assert.equal(game.sentence.disabled, false);
  assert.equal(game.word.disabled, false);
  game.state.speechSession = {};
  game.state.speechState = "speaking";
  game.setMuted(true);
  assert.equal(game.sentence.disabled, true);
  assert.equal(game.word.disabled, true);
  assert.equal(game.word.attributes["aria-label"], "speech.audio.mutednotice");
  assert.equal(game.counters.cancelled, 1);
  game.setMuted(false);
  assert.equal(game.sentence.disabled, false);
  assert.equal(game.word.disabled, false);
  assert.equal(game.counters.spoken, 0);
});

test("unmuting preserves busy, unsupported, missing sentence, and dictionary guards", () => {
  const game = fixture();
  for (const [key, value] of [["busy", true], ["currentSentence", ""], ["translationMode", "off"], ["selectedWord", ""]]) {
    const original = game.state[key];
    game.setMuted(true);
    game.state[key] = value;
    game.setMuted(false);
    if (key === "busy" || key === "currentSentence") assert.equal(game.sentence.disabled, true);
    if (key !== "currentSentence") assert.equal(game.word.disabled, true);
    game.state[key] = original;
  }
  game.setMuted(true);
  game.setSupported(false);
  game.setMuted(false);
  assert.equal(game.sentence.disabled, true);
  assert.equal(game.word.disabled, true);
});

test("global mute blocks programmatic playback and autoplay without consuming the next autoplay", () => {
  const game = fixture();
  game.setMuted(true);
  game.context.toggleCzechSpeech("我", "word");
  game.context.toggleCzechSpeech("我在这里。", "sentence");
  game.context.maybeAutoplayCurrentSentence();
  assert.equal(game.counters.spoken, 0);
  assert.equal(game.state.lastAutoplayFingerprint, "");
  game.setMuted(false);
  assert.equal(game.counters.spoken, 0);
  game.context.maybeAutoplayCurrentSentence();
  assert.equal(game.counters.spoken, 1);
});

test("a cold native voice plays the pending first sentence when initialization finishes", async () => {
  const game = fixture({ native: true });
  assert.equal(game.counters.status, 1);
  assert.equal(game.sentence.disabled, true);
  game.context.maybeAutoplayCurrentSentence();
  assert.equal(game.counters.spoken, 0);
  assert.equal(game.state.lastAutoplayFingerprint, "");
  await game.finishNativeStatus();
  assert.equal(game.sentence.disabled, false);
  assert.equal(game.counters.spoken, 1);
  assert.equal(game.state.lastAutoplayFingerprint, "我在这里。");
  assert.equal(game.state.pendingSpeechAutoplayFingerprint, "");
  game.context.maybeAutoplayCurrentSentence();
  const refreshed = game.context.refreshAndroidSpeechStatus();
  await game.finishNativeStatus();
  await refreshed;
  assert.equal(game.counters.spoken, 1, "subsequent status refreshes cannot replay the sentence");
});

for (const condition of ["hidden-game", "hidden-page", "muted", "autoplay-off", "different-sentence", "voice-unavailable"]) {
  test(`late native readiness respects ${condition}`, async () => {
    const game = fixture({ native: true });
    game.context.maybeAutoplayCurrentSentence();
    if (condition === "hidden-game") game.state.loadingActive = false;
    if (condition === "hidden-page") game.context.document.visibilityState = "hidden";
    if (condition === "muted") game.setMuted(true);
    if (condition === "autoplay-off") game.state.audioAutoplay = false;
    if (condition === "different-sentence") game.state.currentSentence = "你好。";
    await game.finishNativeStatus({ available: condition !== "voice-unavailable" });
    assert.equal(game.counters.spoken, 0);
    assert.equal(game.state.lastAutoplayFingerprint, "");
    assert.equal(game.state.pendingSpeechAutoplayFingerprint,
      condition === "voice-unavailable" ? game.state.currentSentence : "");
  });
}

for (const failure of ["rejected", "unavailable"]) {
  test(`reopening Word World recovers a ${failure} first voice check without polling`, async () => {
    const game = fixture({ native: true });
    game.context.maybeAutoplayCurrentSentence();
    if (failure === "rejected") await game.failNativeStatus();
    else await game.finishNativeStatus({ available: false, reason: "initialization-timeout" });
    assert.equal(game.counters.spoken, 0);
    assert.equal(game.counters.status, 1, "failure alone must not trigger retries");
    game.state.loadingActive = false;
    game.context.resumeSpeechControl();
    assert.equal(game.counters.status, 1, "a hidden game must not start a check");
    game.state.loadingActive = true;
    game.context.resumeSpeechControl();
    game.context.resumeSpeechControl();
    assert.equal(game.counters.status, 2, "concurrent resume notifications share the in-flight check");
    await game.finishNativeStatus();
    assert.equal(game.counters.spoken, 1);
    assert.equal(game.sentence.disabled, false);
    game.context.resumeSpeechControl();
    assert.equal(game.counters.status, 2, "an available voice needs no repeat check");
    assert.equal(game.counters.spoken, 1);
  });
}

test("recovery readiness cannot restart audio already playing or autoplay after the game is left", async () => {
  for (const condition of ["playing", "hidden"]) {
    const game = fixture({ native: true });
    game.context.maybeAutoplayCurrentSentence();
    await game.failNativeStatus();
    game.context.resumeSpeechControl();
    if (condition === "playing") {
      game.state.speechSession = {};
      game.state.speechState = "speaking";
    } else game.state.loadingActive = false;
    await game.finishNativeStatus();
    assert.equal(game.counters.spoken, 0);
    assert.equal(game.counters.cancelled, 0);
    assert.equal(game.state.pendingSpeechAutoplayFingerprint, "");
  }
});
