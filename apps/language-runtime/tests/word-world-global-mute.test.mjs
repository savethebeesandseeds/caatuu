import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../static/source/product-word-world.mjs", import.meta.url), "utf8");
const functions = ["speechGloballyMuted", "syncSpeechControl", "toggleCzechSpeech", "maybeAutoplayCurrentSentence", "initializeSpeechControl"];
const implementation = functions.map((name) => {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} exists`);
  return source.slice(start, source.indexOf("\n}", start) + 2);
}).join("\n");

function fixture() {
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
    lastAutoplayFingerprint: ""
  };
  const counters = { spoken: 0, cancelled: 0 };
  let muted = false;
  let supported = true;
  const context = {
    state,
    window: {
      CaatuuChrome: { getSpeechMuted: () => muted },
      addEventListener: (name, callback) => listeners.set(name, callback)
    },
    $: (selector) => selector === "#wordNetPhraseSound" ? sentence : selector === "#wordNetSelectedWordSound" ? word : null,
    czechSpeechPace: () => ({ label: "normal", source: "override", rate: 1 }),
    speechPaceLabel: () => "Normal",
    interfaceText: (key) => key,
    targetLanguageLabel: "Chinese",
    speechControlSupported: () => supported,
    androidSpeechRuntime: () => null,
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
