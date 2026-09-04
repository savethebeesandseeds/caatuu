import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const chromeSource = await readFile(
  new URL("../static/source/caatuu-chrome.js", import.meta.url),
  "utf8"
);
const bootstrapSource = await readFile(
  new URL("../static/source/app-bootstrap.mjs", import.meta.url),
  "utf8"
);
const mandarinCourse = JSON.parse(await readFile(
  new URL("../../languages/mandarin-simplified/course.json", import.meta.url),
  "utf8"
));

function browserSpeechContext(initialStorage = {}) {
  let spokenUtterance = null;
  let synthesisSpeakCount = 0;
  const storage = new Map(Object.entries(initialStorage).map(([key, value]) => [key, String(value)]));
  const voices = [
    {
      lang: "zh-TW",
      localService: true,
      name: "Local Taiwan voice",
      voiceURI: "zh-tw-local"
    },
    {
      lang: "zh-CN",
      localService: false,
      name: "Mainland Mandarin voice",
      voiceURI: "zh-cn-network"
    },
    {
      lang: "en-US",
      localService: true,
      name: "English voice",
      voiceURI: "en-us-local"
    }
  ];
  class FakeSpeechSynthesisUtterance {
    constructor(text) {
      this.text = text;
    }
  }
  const document = {
    addEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    readyState: "loading"
  };
  const context = {
    CaatuuCourse: {
      ...mandarinCourse,
      targetLanguage: {
        ...mandarinCourse.targetLanguage,
        locale: "zh-Hans",
        speechLocale: "zh-CN"
      }
    },
    CustomEvent: class FakeCustomEvent {
      constructor(type, init = {}) {
        this.type = type;
        this.detail = init.detail;
      }
    },
    document,
    location: { hostname: "127.0.0.1" },
    localStorage: {
      getItem(key) { return storage.has(key) ? storage.get(key) : null; },
      removeItem(key) { storage.delete(key); },
      setItem(key, value) { storage.set(key, String(value)); }
    },
    SpeechSynthesisUtterance: FakeSpeechSynthesisUtterance,
    speechSynthesis: {
      cancel() {},
      getVoices() { return voices; },
      speak(utterance) {
        synthesisSpeakCount += 1;
        spokenUtterance = utterance;
        setTimeout(() => {
          utterance.onstart?.({ type: "start" });
          utterance.onend?.({ type: "end" });
        }, 0);
      }
    },
    addEventListener() {},
    clearTimeout,
    dispatchEvent() {},
    setTimeout
  };
  context.window = context;
  return {
    context,
    storedValue: (key) => storage.get(key),
    synthesisSpeakCount: () => synthesisSpeakCount,
    spokenUtterance: () => spokenUtterance
  };
}

test("shared speech uses zh-CN and exposes generic APIs with Czech compatibility aliases", async () => {
  const browser = browserSpeechContext();
  vm.runInNewContext(chromeSource, browser.context, { filename: "caatuu-chrome.js" });

  const speech = browser.context.CaatuuChrome;
  assert.equal(typeof speech.speakText, "function");
  assert.equal(speech.speakCzechText, speech.speakText);
  assert.equal(speech.stopCzechSpeech, speech.stopSpeech);
  assert.equal(speech.previewCzechSpeech, speech.previewSpeech);
  assert.equal(speech.installCzechSpeechData, speech.installSpeechData);

  const voiceState = await speech.listSpeechVoiceOptions();
  assert.deepEqual(
    voiceState.voices.map(({ id }) => id),
    ["zh-cn-network", "zh-tw-local"],
    "the exact course speech locale must rank ahead of a different regional voice"
  );

  await speech.speakText("你好", { locale: "cs-CZ", rate: 0.5 });
  const utterance = browser.spokenUtterance();
  assert.equal(utterance.text, "你好");
  assert.equal(utterance.lang, "zh-CN", "course speechLocale must be authoritative");
  assert.equal(utterance.rate, 0.5, "the shared browser provider must preserve the selected rate");
  assert.equal(utterance.voice.voiceURI, "zh-cn-network");
});

test("speech pace migrates from the course key and subsequent choices use global storage", () => {
  const legacyPaceKey = `${mandarinCourse.storage.namespace || `caatuu-${mandarinCourse.id}`}.speech.pace.v1`;
  const globalPaceKey = "caatuu.speech.pace.v1";
  const browser = browserSpeechContext({ [legacyPaceKey]: "slow" });
  vm.runInNewContext(chromeSource, browser.context, { filename: "caatuu-chrome.js" });

  const speech = browser.context.CaatuuChrome;
  assert.equal(speech.getSpeechPacePreference(), "slow");
  assert.equal(browser.storedValue(globalPaceKey), "slow", "the legacy course pace must migrate once");

  const selected = speech.setSpeechPacePreference("slower");
  assert.equal(selected.key, "slower");
  assert.equal(browser.storedValue(globalPaceKey), "slower", "new pace choices must use the global key");
  assert.equal(browser.storedValue(legacyPaceKey), "slow", "migration must not rewrite course-owned history");
});

test("master mute gates browser and native synthesis until sound is restored", async () => {
  const muteKey = "caatuu.speech.muted.v1";
  const browser = browserSpeechContext({ [muteKey]: "true" });
  vm.runInNewContext(chromeSource, browser.context, { filename: "caatuu-chrome.js" });

  const browserSpeech = browser.context.CaatuuChrome;
  const mutedBrowserResult = await browserSpeech.speakText("你好");
  assert.equal(mutedBrowserResult.outcome, "muted");
  assert.equal(mutedBrowserResult.muted, true);
  assert.equal(browser.synthesisSpeakCount(), 0, "muting must suppress browser synthesis");
  assert.equal(browser.spokenUtterance(), null);

  browserSpeech.setSpeechMuted(false);
  const audibleBrowserResult = await browserSpeech.speakText("你好");
  assert.equal(audibleBrowserResult.outcome, "completed");
  assert.equal(browser.synthesisSpeakCount(), 1, "unmuting must restore browser synthesis");

  const native = browserSpeechContext({ [muteKey]: "true" });
  let nativeSpeakCount = 0;
  native.context.CaatuuRuntime = {
    env: "android",
    speech: {
      async speak() {
        nativeSpeakCount += 1;
        return { outcome: "completed" };
      },
      async stop() {
        return { stopped: true };
      }
    }
  };
  vm.runInNewContext(chromeSource, native.context, { filename: "caatuu-chrome.js" });

  const nativeSpeech = native.context.CaatuuChrome;
  const mutedNativeResult = await nativeSpeech.speakText("你好");
  assert.equal(mutedNativeResult.outcome, "muted");
  assert.equal(mutedNativeResult.muted, true);
  assert.equal(nativeSpeakCount, 0, "muting must suppress native synthesis");

  nativeSpeech.setSpeechMuted(false);
  const audibleNativeResult = await nativeSpeech.speakText("你好");
  assert.equal(audibleNativeResult.outcome, "completed");
  assert.equal(nativeSpeakCount, 1, "unmuting must restore native synthesis");
});

test("Mandarin native speech uses zh-CN without loading the Czech LLM course runtime", async () => {
  assert.equal(mandarinCourse.capabilities.speech, true);
  assert.equal(mandarinCourse.capabilities.llm, false);
  assert.equal(mandarinCourse.capabilities.verbs, false);

  assert.doesNotMatch(bootstrapSource, /COURSE_RUNTIME_CAPABILITIES/u);
  assert.match(bootstrapSource, /declaredBrowserProvider\("courseRuntime"\)/u);

  const providers = bootstrapSource.slice(
    bootstrapSource.indexOf("async function loadCourseFeatureProviders"),
    bootstrapSource.indexOf("async function registerCourseServiceWorker")
  );
  assert.ok(
    providers.indexOf("installSharedSpeechRuntime();")
      < providers.indexOf("initializeWorkspaceAfterDictionaryProvider"),
    "speech provider installation must occur before shared workspace initialization"
  );
  assert.doesNotMatch(providers, /\bverbs\b/u);

  const sharedSpeechBoundary = bootstrapSource.slice(
    bootstrapSource.indexOf("function installSharedSpeechRuntime"),
    bootstrapSource.indexOf("function setCourseIdentity")
  );
  assert.match(sharedSpeechBoundary, /course\.targetLanguage\?\.speechLocale/u);
  assert.match(sharedSpeechBoundary, /"speech_speak"/u);
  assert.doesNotMatch(sharedSpeechBoundary, /OpenAI|WebLLM|models?\.|generate|chat/iu);

  const nativeRequests = [];
  const nativeContext = {
    CaatuuAndroid: {
      postMessage(rawRequest) {
        nativeRequests.push(JSON.parse(rawRequest));
      }
    },
    course: mandarinCourse,
    clearTimeout,
    setTimeout
  };
  vm.runInNewContext(
    bootstrapSource.slice(
      bootstrapSource.indexOf("const nativeSpeechPending"),
      bootstrapSource.indexOf("function setCourseIdentity")
    ),
    nativeContext,
    { filename: "app-bootstrap-speech-boundary.mjs" }
  );

  nativeContext.installSharedSpeechRuntime();
  assert.equal(nativeContext.CaatuuRuntime.env, "android");

  const statusPromise = nativeContext.CaatuuRuntime.speech.status("cs-CZ");
  const statusRequest = nativeRequests.shift();
  assert.equal(statusRequest.type, "speech_status");
  assert.equal(statusRequest.locale, "zh-CN");
  nativeContext.CaatuuNative.receive({
    id: statusRequest.id,
    kind: "done",
    result: { available: true, locale: "zh-CN" }
  });
  assert.equal((await statusPromise).locale, "zh-CN");

  const speakPromise = nativeContext.CaatuuRuntime.speech.speak("你好", { locale: "cs-CZ", rate: 0.75 });
  const speakRequest = nativeRequests.shift();
  assert.equal(speakRequest.type, "speech_speak");
  assert.equal(speakRequest.locale, "zh-CN");
  assert.equal(speakRequest.text, "你好");
  assert.equal(speakRequest.rate, 0.75, "the Android bridge request must preserve the selected rate");
  nativeContext.CaatuuNative.receive({
    id: speakRequest.id,
    kind: "done",
    result: { outcome: "completed" }
  });
  assert.equal((await speakPromise).outcome, "completed");
});
