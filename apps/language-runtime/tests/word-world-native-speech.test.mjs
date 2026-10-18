import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import test from "node:test";
import vm from "node:vm";

import { mountWordWorld } from "../static/source/word-world-provider.mjs";
import { importBrowserLanguageAdapter } from "./browser-module-loader.mjs";
import { createBrowserHarness } from "./helpers/fake-browser.mjs";
import { installEnglishInterfaceContent } from "./helpers/english-interface-content.mjs";

const execFileAsync = promisify(execFile);
const CHILD_FLAG = "--native-speech-scenario";
const RESULT_MARKER = "CAATUU_WORD_WORLD_NATIVE_SPEECH=";
const course = JSON.parse(await readFile(new URL("../../languages/mandarin-simplified/course.json", import.meta.url), "utf8"));
const voiceKey = `${course.storage.namespace}.speech.voice.v1`;

async function runScenario(scenario) {
  const staleVoice = ["stale-voice", "stale-result", "storage-failure"].includes(scenario);
  let missingData = scenario === "missing-data";
  const muted = scenario === "muted";
  const app = createBrowserHarness({
    course,
    localStorageValues: {
      [voiceKey]: `android:${staleVoice ? "removed-voice" : "saved-voice"}`,
      "caatuu.speech.autoplay.v1": "false",
      "caatuu.speech.pace.v1": "slow",
      "caatuu.speech.volume.v1": muted ? "0" : "0.75",
      [course.storage.wordWorldTranslationMode]: "visible",
      [`${course.storage.namespace}.wordNet.targetTextPreferences.v1`]: JSON.stringify({ showGuide: false, colorTones: false })
    },
    runtime: { env: "android" },
    location: { pathname: "/zh/", href: "https://caatuu.test/zh/" }
  });
  installEnglishInterfaceContent(app);
  if (scenario === "storage-failure") {
    app.localStorage.removeItem = () => { throw new Error("Voice preference storage is unavailable"); };
  }
  app.window.CaatuuLearning = { difficulty: () => 1, record() {} };
  const requests = [];
  let delayedStatus;
  const voice = { id: "saved-voice", name: "Mandarin device voice", locale: "zh-CN", localService: true };
  const deliver = (request, result) => app.context.CaatuuNative.receive({ id: request.id, kind: "done", result });
  const transport = {
    postMessage(rawRequest) {
      const request = JSON.parse(rawRequest);
      requests.push(request);
      if (request.type === "speech_status") {
        const unavailable = request.voice === "removed-voice";
        const result = {
          available: !missingData && !unavailable,
          reason: missingData ? "missing-language-data" : unavailable ? "no-language-voice" : "",
          requestedVoice: request.voice,
          requestedVoiceAvailable: !unavailable,
          voice: missingData || unavailable ? "" : request.voice || voice.id,
          localService: true,
          localVoiceAvailable: !missingData,
          voices: missingData ? [] : [voice]
        };
        if (scenario === "stale-result" && unavailable) delayedStatus = () => deliver(request, result);
        else queueMicrotask(() => deliver(request, result));
      } else if (request.type === "speech_speak") {
        queueMicrotask(() => {
          app.context.CaatuuNative.receive({ id: request.id, kind: "speech", phase: "started" });
          deliver(request, { outcome: "completed", runtime: "android-text-to-speech" });
        });
      } else if (request.type === "speech_stop") {
        queueMicrotask(() => deliver(request, { stopped: true }));
      } else throw new Error(`Unexpected native request: ${request.type}`);
    }
  };
  app.context.CaatuuAndroid = app.window.CaatuuAndroid = transport;
  app.context.CaatuuRuntime = app.window.CaatuuRuntime;
  app.context.course = course;
  app.context.t = app.window.CaatuuI18n.t;
  app.context.languageName = app.window.CaatuuI18n.languageName;
  const [chromeSource, bootstrapSource, authorityHtml] = await Promise.all([
    readFile(new URL("../static/source/caatuu-chrome.js", import.meta.url), "utf8"),
    readFile(new URL("../static/source/app-bootstrap.mjs", import.meta.url), "utf8"),
    readFile(new URL("../static/app/index.html", import.meta.url), "utf8")
  ]);
  // Install the actual speech providers before mounting the game. Shell-only
  // DOM initialization waits for DOMContentLoaded, which this harness omits.
  app.document.readyState = "loading";
  vm.runInContext(chromeSource, app.context, { filename: "caatuu-chrome.js" });
  vm.runInContext(bootstrapSource.slice(
    bootstrapSource.indexOf("const nativeSpeechPending"),
    bootstrapSource.indexOf("function setCourseIdentity")
  ), app.context, { filename: "app-bootstrap-speech-boundary.mjs" });
  app.context.installSharedSpeechRuntime();
  app.window.CaatuuRuntime = app.context.CaatuuRuntime;
  app.registry.seed(authorityHtml);
  app.document.readyState = "complete";
  app.document.documentElement.dataset.theme = "dark";
  app.document.documentElement.dataset.fontSize = "largest";
  for (const element of app.registry.elements) element.ownerDocument = app.document;
  app.window.Image = class { set src(_value) { queueMicrotask(() => this.onerror?.(new Error("No image in speech contract"))); } };
  app.window.parent = app.window;
  app.window.navigator.onLine = false;
  Object.assign(globalThis, {
    window: app.window,
    document: app.document,
    location: app.window.location,
    localStorage: app.localStorage,
    CaatuuI18n: app.window.CaatuuI18n,
    Image: app.window.Image
  });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: app.window.navigator });
  globalThis.fetch = async () => new Response("not found", { status: 404 });
  const loadJson = async (url) => {
    const path = new URL(url, app.window.location.href).pathname;
    const file = path.startsWith("/zh/")
      ? new URL(path.slice("/zh/".length), new URL("../../languages/mandarin-simplified/static/", import.meta.url))
      : new URL(path.slice("/language-runtime/static/".length), new URL("../static/", import.meta.url));
    return JSON.parse(await readFile(file, "utf8"));
  };
  const manifest = await loadJson("https://caatuu.test/zh/data/games/word-world/manifest.json");
  const adapter = await importBrowserLanguageAdapter("../../languages/mandarin-simplified/static/source/language/adapter.mjs");
  const rendererUrl = new URL("../static/source/product-word-world.mjs", import.meta.url);
  rendererUrl.searchParams.set("native-speech", scenario);
  const controller = await mountWordWorld(app.registry.element("wordWorldRoot"), course, manifest, {
    origin: app.window.location.origin,
    adapter,
    runtime: app.window.CaatuuRuntime,
    embeddingRanker: null,
    random: () => 0,
    loadJson,
    rendererImport: () => import(rendererUrl.href)
  });
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  await settle();
  if (scenario === "stale-result") {
    assert.equal(typeof delayedStatus, "function");
    app.window.CaatuuChrome.setSpeechVoicePreference("android:replacement-voice");
    await settle();
    delayedStatus();
    await settle();
  }
  const phrase = app.registry.element("wordNetPhraseSound");
  const sentence = app.registry.element("wordNetSentence");
  const targetText = [...sentence.querySelectorAll(".cz-word-token, .cz-punctuation-token")]
    .map((node) => node.dataset.word || node.textContent).join("");
  const enabledBeforeClick = !phrase.disabled;
  const statusCount = requests.filter(({ type }) => type === "speech_status").length;
  const spokenBeforeClick = requests.filter(({ type }) => type === "speech_speak").length;
  phrase.click();
  await settle();
  await settle();
  let playbackStatusBeforeLoss;
  if (scenario === "lost-language-data") {
    playbackStatusBeforeLoss = (await app.window.CaatuuChrome.listSpeechVoiceOptions()).playbackStatus;
    missingData = true;
    app.window.dispatchEvent(new app.window.CustomEvent("caatuu:speech-voices-refresh"));
    await settle();
    phrase.click();
    await settle();
  }
  const result = {
    enabledBeforeClick,
    enabledAfterClick: !phrase.disabled,
    playbackStatusBeforeLoss,
    targetText,
    spokenBeforeClick,
    statusRequests: requests.filter(({ type }) => type === "speech_status"),
    speechRequests: requests.filter(({ type }) => type === "speech_speak"),
    statusCountBeforeClick: statusCount,
    storedVoice: app.localStorage.getItem(voiceKey),
    storedVolume: app.localStorage.getItem("caatuu.speech.volume.v1"),
    autoplay: app.window.CaatuuChrome.getSpeechAutoplay(),
    menuHidden: app.registry.element("wordNetAudioMenu").hidden
  };
  controller.pause();
  return result;
}

async function executeScenario(scenario) {
  const { stdout, stderr } = await execFileAsync(process.execPath, [
    new URL(import.meta.url).pathname, CHILD_FLAG, scenario
  ], { timeout: 15_000, maxBuffer: 1_000_000 });
  const line = stdout.split(/\r?\n/u).find((value) => value.startsWith(RESULT_MARKER));
  assert.ok(line, `native speech scenario did not return a result:\n${stdout}\n${stderr}`);
  return JSON.parse(line.slice(RESULT_MARKER.length));
}

if (process.argv[2] === CHILD_FLAG) {
  try {
    process.stdout.write(`${RESULT_MARKER}${JSON.stringify(await runScenario(process.argv[3]))}\n`);
    process.exit(0);
  } catch (error) {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exit(1);
  }
} else {
  test("Mandarin phrase click with autoplay off reaches the native provider with the selected voice, pace and volume", async () => {
    const result = await executeScenario("manual");
    assert.equal(result.enabledBeforeClick, true);
    assert.equal(result.autoplay, false);
    assert.equal(result.spokenBeforeClick, 0);
    assert.equal(result.speechRequests.length, 1);
    assert.match(result.targetText, /\p{Script=Han}/u);
    const request = result.speechRequests[0];
    assert.equal(request.text, result.targetText);
    assert.equal(request.locale, "zh-CN");
    assert.equal(request.voice, "saved-voice");
    assert.equal(request.rate, 0.6);
    assert.equal(request.volume, 10 ** ((0.75 - 1) * 2));
  });

  test("Word World recovers an unavailable saved native voice without opening audio settings", async () => {
    const result = await executeScenario("stale-voice");
    assert.equal(result.enabledBeforeClick, true);
    assert.deepEqual(result.statusRequests.map(({ voice }) => voice), ["removed-voice", ""]);
    assert.equal(result.storedVoice, null);
    assert.equal(result.menuHidden, true);
    assert.equal(result.spokenBeforeClick, 0, "recovery must preserve autoplay off");
    assert.equal(result.speechRequests.length, 1);
    assert.equal(result.speechRequests[0].voice, "");
    assert.equal(result.speechRequests[0].text, result.targetText);
    assert.equal(result.speechRequests[0].locale, "zh-CN");
  });

  test("a late unavailable result cannot clear a newer native voice selection", async () => {
    const result = await executeScenario("stale-result");
    assert.equal(result.enabledBeforeClick, true);
    assert.equal(result.storedVoice, "android:replacement-voice");
    assert.deepEqual(result.statusRequests.map(({ voice }) => voice), ["removed-voice", "replacement-voice"]);
    assert.equal(result.speechRequests.length, 1);
    assert.equal(result.speechRequests[0].voice, "replacement-voice");
  });

  test("unavailable voice recovery stays bounded when saved preferences cannot be cleared", async () => {
    const result = await executeScenario("storage-failure");
    assert.equal(result.enabledBeforeClick, false);
    assert.equal(result.storedVoice, "android:removed-voice");
    assert.deepEqual(result.statusRequests.map(({ voice }) => voice), ["removed-voice", "removed-voice"]);
    assert.deepEqual(result.speechRequests, []);
  });

  test("a previous native playback confirmation cannot override later missing language data", async () => {
    const result = await executeScenario("lost-language-data");
    assert.equal(result.enabledBeforeClick, true);
    assert.equal(result.playbackStatusBeforeLoss, "confirmed");
    assert.equal(result.enabledAfterClick, false);
    assert.equal(result.speechRequests.length, 1, "native data loss must block a second phrase request");
    assert.equal(result.statusRequests.length, 3, "refresh performs one raw check without recovery retries");
    assert.equal(result.storedVoice, "android:saved-voice");
  });

  for (const scenario of ["muted", "missing-data"]) {
    test(`${scenario} keeps Mandarin phrase playback disabled without retrying native status`, async () => {
      const result = await executeScenario(scenario);
      assert.equal(result.enabledBeforeClick, false);
      assert.equal(result.spokenBeforeClick, 0);
      assert.deepEqual(result.speechRequests, []);
      assert.equal(result.statusRequests.length, 1);
      assert.equal(result.statusCountBeforeClick, 1);
      assert.equal(result.storedVoice, "android:saved-voice");
      assert.equal(result.storedVolume, scenario === "muted" ? "0" : "0.75");
    });
  }
}
