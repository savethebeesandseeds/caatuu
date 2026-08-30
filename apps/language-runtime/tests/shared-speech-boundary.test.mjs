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

function browserSpeechContext() {
  let spokenUtterance = null;
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
    document,
    location: { hostname: "127.0.0.1" },
    localStorage: {
      getItem() { return null; },
      removeItem() {},
      setItem() {}
    },
    SpeechSynthesisUtterance: FakeSpeechSynthesisUtterance,
    speechSynthesis: {
      cancel() {},
      getVoices() { return voices; },
      speak(utterance) {
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

test("Mandarin native speech uses zh-CN without loading the Czech LLM course runtime", async () => {
  assert.equal(mandarinCourse.capabilities.speech, true);
  assert.equal(mandarinCourse.capabilities.llm, false);
  assert.equal(mandarinCourse.capabilities.verbs, false);

  const runtimeCapabilities = /const COURSE_RUNTIME_CAPABILITIES = Object\.freeze\(\[([\s\S]*?)\]\);/u
    .exec(bootstrapSource)?.[1] || "";
  assert.doesNotMatch(runtimeCapabilities, /speech/u);
  assert.match(runtimeCapabilities, /"llm"/u);

  const providers = bootstrapSource.slice(
    bootstrapSource.indexOf("async function loadCourseFeatureProviders"),
    bootstrapSource.indexOf("async function registerCourseServiceWorker")
  );
  assert.ok(
    providers.indexOf("installSharedSpeechRuntime();") < providers.indexOf("if (!verbs) return;"),
    "speech provider installation must occur before the verb-feature gate"
  );

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
      bootstrapSource.indexOf("const COURSE_RUNTIME_CAPABILITIES"),
      bootstrapSource.indexOf("function setCourseIdentity")
    ),
    nativeContext,
    { filename: "app-bootstrap-speech-boundary.mjs" }
  );

  assert.equal(nativeContext.requiresCourseRuntime(), false);
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

  const speakPromise = nativeContext.CaatuuRuntime.speech.speak("你好", { locale: "cs-CZ", rate: 0.6 });
  const speakRequest = nativeRequests.shift();
  assert.equal(speakRequest.type, "speech_speak");
  assert.equal(speakRequest.locale, "zh-CN");
  assert.equal(speakRequest.text, "你好");
  assert.equal(speakRequest.rate, 0.6, "the Android bridge request must preserve the selected rate");
  nativeContext.CaatuuNative.receive({
    id: speakRequest.id,
    kind: "done",
    result: { outcome: "completed" }
  });
  assert.equal((await speakPromise).outcome, "completed");
});
