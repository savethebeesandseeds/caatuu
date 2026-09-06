import assert from "node:assert/strict";
import test from "node:test";

import { AUDIO_LAB_MESSAGES, createAudioLabSpeechService, mountAudioLab } from "../static/source/developer-tools/audio-lab.mjs";
import { createBrowserHarness } from "./helpers/fake-browser.mjs";

const selectedCourse = Object.freeze({
  id: "zh", routePrefix: "/zh",
  targetLanguage: Object.freeze({ id: "zh", locale: "zh-Hans", speechLocale: "zh-CN", label: "Mandarin", direction: "ltr" })
});
const deviceVoices = [
  { voiceURI: "english", name: "English", lang: "en-US", localService: true },
  { voiceURI: "taiwan", name: "Taiwan Mandarin", lang: "zh-TW", localService: true },
  { voiceURI: "mainland", name: "Mainland Mandarin", lang: "zh-CN", localService: false },
  { voiceURI: "czech", name: "Czech", lang: "cs-CZ", localService: true }
];
const flush = () => new Promise((resolve) => setImmediate(resolve));

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

function translate(key, parameters = {}) {
  assert.equal(typeof AUDIO_LAB_MESSAGES[key], "string", `Unknown Audio Lab interface key: ${key}`);
  return AUDIO_LAB_MESSAGES[key].replace(/\{([a-zA-Z]+)\}/gu, (_match, name) => {
    assert.ok(Object.hasOwn(parameters, name), `Missing ${name} for ${key}`);
    return parameters[name];
  });
}

function browser() {
  const harness = createBrowserHarness();
  const { document, window: host } = harness;
  let voices = deviceVoices;
  let muted = false;
  let cancels = 0;
  let sharedStops = 0;
  const utterances = [];
  const speechListeners = new Set();
  host.CaatuuCourse = Object.freeze({ id: "cz", targetLanguage: { speechLocale: "cs-CZ" } });
  host.CaatuuChrome = {
    getSpeechMuted: () => muted,
    resolveSpeechPace: () => ({ rate: 0.75 }),
    async stopSpeech() { sharedStops += 1; },
    setSpeechVoicePreference() { assert.fail("The diagnostic must not change saved voices"); },
    setSpeechPacePreference() { assert.fail("The diagnostic must not change saved speed"); },
    setSpeechMuted() { assert.fail("The diagnostic must not change shared mute"); }
  };
  host.SpeechSynthesisUtterance = class Utterance {
    constructor(text) { this.text = text; }
  };
  host.speechSynthesis = {
    getVoices: () => voices,
    speak(utterance) { utterances.push(utterance); utterance.onstart?.(); },
    cancel() { cancels += 1; },
    addEventListener(event, callback) { if (event === "voiceschanged") speechListeners.add(callback); },
    removeEventListener(event, callback) { if (event === "voiceschanged") speechListeners.delete(callback); }
  };
  const root = document.createElement("section");
  document.body.append(root);
  return {
    ...harness, host, root, utterances,
    cancels: () => cancels,
    sharedStops: () => sharedStops,
    setMuted(value) { muted = value; host.dispatchEvent({ type: "caatuu:speech-mute-change" }); },
    setVoices(value) { voices = value; for (const listener of speechListeners) listener(); },
    voiceListeners: () => speechListeners.size,
    control(name) { return root.querySelector(`[data-audio-lab-${name}]`); }
  };
}

test("browser Audio Lab selects the diagnostic locale and ranks exact voices before regional fallback", async () => {
  const harness = browser();
  const service = createAudioLabSpeechService({ host: harness.host, locale: "zh-CN" });
  const status = await service.status();
  assert.equal(status.available, true);
  assert.deepEqual(status.voices.map(({ id }) => id), ["mainland", "taiwan"]);
  const speaking = service.speak("你好", { rate: 1.2, pitch: 0.8 });
  await flush();
  const utterance = harness.utterances[0];
  assert.equal(utterance.lang, "zh-CN");
  assert.equal(utterance.voice.voiceURI, "mainland");
  assert.equal(utterance.rate, 1.2);
  assert.equal(utterance.pitch, 0.8);
  assert.equal(harness.sharedStops(), 1);
  assert.equal(harness.host.CaatuuCourse.id, "cz");
  utterance.onend();
  assert.equal((await speaking).outcome, "completed");
  await service.dispose();
});

test("choosing a diagnostic voice is local and an unavailable choice falls back within the selected language", async () => {
  const harness = browser();
  const service = createAudioLabSpeechService({ host: harness.host, locale: "zh-CN" });
  for (const [voice, expected] of [["taiwan", "taiwan"], ["english", "mainland"]]) {
    const speaking = service.speak("你好", { voice });
    await flush();
    const utterance = harness.utterances.at(-1);
    assert.equal(utterance.voice.voiceURI, expected);
    utterance.onend();
    await speaking;
  }
  await service.dispose();
});

test("Stop settles browser speech without relying on cancel callbacks and idle cleanup does not stop other audio", async () => {
  const harness = browser();
  const service = createAudioLabSpeechService({ host: harness.host, locale: "cs-CZ" });
  const speaking = service.speak("Test");
  await flush();
  await service.stop();
  assert.equal((await speaking).stopped, true);
  assert.equal(harness.utterances[0].onend, null);
  assert.equal(harness.utterances[0].onerror, null);
  const stoppedCount = harness.cancels();
  await service.dispose();
  assert.equal(harness.cancels(), stoppedCount);
});

test("shared mute suppresses playback without changing preferences or interrupting audio", async () => {
  const harness = browser();
  harness.setMuted(true);
  const service = createAudioLabSpeechService({ host: harness.host, locale: "zh-CN" });
  assert.equal((await service.speak("你好")).muted, true);
  assert.equal(harness.utterances.length, 0);
  assert.equal(harness.sharedStops(), 0);
  assert.equal(harness.cancels(), 0);
  await service.dispose();
});

test("disposing while shared speech is stopping prevents late diagnostic playback", async () => {
  const harness = browser();
  const stopping = deferred();
  harness.host.CaatuuChrome.stopSpeech = () => stopping.promise;
  const service = createAudioLabSpeechService({ host: harness.host, locale: "zh-CN" });
  const speaking = service.speak("你好");
  await flush();
  await service.dispose();
  stopping.resolve();
  assert.equal((await speaking).stopped, true);
  assert.equal(harness.utterances.length, 0);
});

test("native diagnostics use the explicit selected-locale factory without changing the active course", async () => {
  const harness = browser();
  const calls = [];
  let speechStarted = false;
  harness.host.CaatuuRuntime = {
    env: "android",
    speech: {
      status() { assert.fail("Do not use the pinned active-course status"); },
      speak() { assert.fail("Do not use the pinned active-course playback"); },
      forLocale(locale) {
        calls.push(["factory", locale]);
        return {
          async status(requested, options) {
            calls.push(["status", requested, options]);
            return { available: true, locale, voices: [{ id: "mandarin", name: "Mandarin", locale, localService: true }] };
          },
          async speak(text, options, handlers) {
            calls.push(["speak", text, options]);
            handlers.onEvent({ kind: "speech", phase: "started" });
            return { outcome: "completed" };
          },
          async stop() { calls.push(["stop"]); }
        };
      }
    }
  };
  const service = createAudioLabSpeechService({ host: harness.host, locale: "zh-CN" });
  assert.equal((await service.status()).available, true);
  await service.speak("你好", { voice: "mandarin", rate: 0.7, pitch: 1.1, onStart: () => { speechStarted = true; } });
  assert.deepEqual(calls[0], ["factory", "zh-CN"]);
  assert.deepEqual(calls.find(([kind]) => kind === "speak"), [
    "speak", "你好", { locale: "zh-CN", voice: "mandarin", rate: 0.7, pitch: 1.1 }
  ]);
  assert.equal(speechStarted, true);
  assert.equal(harness.host.CaatuuCourse.id, "cz");
  await service.dispose();
});

test("Audio Lab never substitutes a different language when device voices are absent", async () => {
  const harness = browser();
  harness.setVoices(deviceVoices.filter(({ lang }) => !lang.startsWith("zh")));
  const cleanup = await mountAudioLab({ root: harness.root, course: selectedCourse, host: harness.host, t: translate });
  await flush();
  assert.equal(harness.control("play").disabled, true);
  assert.match(harness.control("status").textContent, /No voice is available for Mandarin/u);
  assert.equal(harness.control("text").value, "", "The tool does not invent language samples");
  assert.equal(harness.control("text").lang, "zh-Hans");
  harness.setVoices(deviceVoices);
  await flush();
  assert.equal(harness.control("play").disabled, false);
  assert.match(harness.control("status").textContent, /Ready to test Mandarin/u);
  await cleanup();
  assert.equal(harness.voiceListeners(), 0);
});

test("Audio Lab recovers its controls after playback errors and honors mute changes during a preview", async () => {
  const harness = browser();
  const cleanup = await mountAudioLab({ root: harness.root, course: selectedCourse, host: harness.host, t: translate });
  await flush();
  harness.control("text").value = "你好";
  assert.equal(harness.control("rate").value, "0.75");
  harness.control("play").click();
  await flush();
  assert.equal(harness.control("play").disabled, true);
  assert.equal(harness.control("stop").disabled, false);
  harness.utterances.at(-1).onerror({ error: "synthesis-failed" });
  await flush();
  assert.match(harness.control("status").textContent, /Audio preview failed: synthesis-failed/u);
  assert.equal(harness.control("play").disabled, false);
  harness.control("play").click();
  await flush();
  harness.setMuted(true);
  await flush();
  assert.equal(harness.control("play").disabled, true);
  assert.equal(harness.control("stop").disabled, true);
  assert.match(harness.control("status").textContent, /Audio is muted/u);
  harness.setMuted(false);
  await flush();
  assert.equal(harness.control("play").disabled, false);
  await cleanup();
});

test("disposing a mounted native tool ignores a late voice response and preserves its replacement", async () => {
  const harness = browser();
  const response = deferred();
  harness.host.CaatuuRuntime = { env: "android", speech: {
    status: () => response.promise,
    speak: async () => ({ outcome: "completed" }),
    stop: async () => ({ stopped: true })
  } };
  const cleanup = await mountAudioLab({ root: harness.root, course: selectedCourse, host: harness.host, t: translate });
  await cleanup();
  const replacement = harness.document.createElement("p");
  replacement.textContent = "Different inspector";
  harness.root.append(replacement);
  response.resolve({ available: true, voices: [] });
  await flush();
  assert.equal(harness.root.children.length, 1);
  assert.equal(harness.root.children[0], replacement);
  assert.equal(harness.voiceListeners(), 0);
});
