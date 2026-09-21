import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { createBrowserHarness } from "./helpers/fake-browser.mjs";
import { englishInterfaceContent } from "./helpers/english-interface-content.mjs";

const source = await readFile(new URL("../static/source/app-bootstrap.mjs", import.meta.url), "utf8");
const speechCheckSource = source.slice(source.indexOf("function installSetupSpeechCheck()"), source.indexOf("const READY_HOME_ART"));
const flush = () => new Promise(setImmediate);
const available = { backend: "browser", available: true, voices: [{ id: "course-voice" }] };
const missing = { backend: "browser", available: true, voices: [] };

function mount(t, { query = async () => available, playback = async () => ({ outcome: "completed" }), controlsReady = true } = {}) {
  const course = { capabilities: { speech: true }, targetLanguage: { id: "nb", locale: "nb-NO" } };
  const app = createBrowserHarness({ course });
  const { document, context, window } = app;
  const timers = new Map();
  let sequence = 0;
  let queries = 0;
  let plays = 0;
  const voiceListeners = new Set();
  const node = (tag, id, parent) => {
    const element = document.createElement(tag);
    element.id = id;
    parent.append(element);
    return element;
  };
  const card = node("section", "nativeSetup", document.body);
  card.classList.toggle("is-ready", controlsReady);
  const title = node("h2", "setupTitle", card);
  title.textContent = englishInterfaceContent.t("setup.preparing");
  const warning = node("span", "setupVoiceWarning", card);
  warning.hidden = true;
  const artifacts = node("div", "setupArtifacts", card);
  document.documentElement.dataset.caatuuShellReady = controlsReady ? "true" : "loading";
  document.body.classList.toggle("setup-blocked", !controlsReady);
  Object.assign(context, {
    course,
    t: englishInterfaceContent.t,
    languageName: () => "Norwegian",
    addEventListener: window.addEventListener.bind(window),
    removeEventListener: window.removeEventListener.bind(window),
    setTimeout(callback, delay) { const id = ++sequence; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    speechSynthesis: {
      addEventListener(_event, callback) { voiceListeners.add(callback); },
      removeEventListener(_event, callback) { voiceListeners.delete(callback); }
    },
    CaatuuChrome: {
      listSpeechVoiceOptions() { queries++; return query(); },
      previewSpeech() { plays++; return playback(); }
    }
  });
  vm.runInContext(`${speechCheckSource}\ninstallSetupSpeechCheck();`, context);
  const check = context.CaatuuSetupSpeechCheck;
  t.after(() => check.dispose());
  return {
    ...app, card, title, warning, artifacts, timers, check,
    get row() { return artifacts.querySelector('[data-kind="speech-voice"]'); },
    get queries() { return queries; }, get plays() { return plays; },
    changed() { voiceListeners.forEach(callback => callback()); },
    async runTimer(delay) {
      const entry = [...timers].find(([, timer]) => timer.delay === delay);
      assert.ok(entry, `expected a ${delay}ms timer`);
      timers.delete(entry[0]);
      entry[1].callback();
      await flush();
    }
  };
}

test("a browser speech API without a matching voice stays pending, then voiceschanged updates the checklist", async t => {
  let result = missing;
  const app = mount(t, { query: async () => result });
  await flush();
  assert.equal(app.row.dataset.ready, "false");
  assert.equal(app.title.textContent, englishInterfaceContent.t("setup.readytitle"));
  assert.equal(app.warning.hidden, false, "a missing voice is visible during background retries");
  assert.equal(app.plays, 0, "startup never plays speech automatically");
  result = available;
  app.changed();
  await flush();
  assert.equal(app.row.dataset.ready, "true");
  assert.equal(app.title.textContent, englishInterfaceContent.t("setup.readytitle"));
  assert.equal(app.timers.size, 0);
  assert.equal(app.warning.hidden, true);
});

test("bounded retries recover delayed voices without an event and a missing voice leaves a retry action", async t => {
  let result = missing;
  const app = mount(t, { query: async () => result });
  await flush();
  for (const delay of [250, 750, 1500, 3000, 5000]) await app.runTimer(delay);
  assert.equal(app.queries, 6);
  assert.equal(app.row.dataset.status, "warning");
  assert.equal(app.title.textContent, englishInterfaceContent.t("setup.readytitle"));
  assert.equal(app.warning.hidden, false);
  assert.equal(app.timers.size, 0, "missing voices do not cause endless polling");
  assert.equal(app.row.querySelector("span").textContent, englishInterfaceContent.t("setup.voice.unverified"));
  assert.equal(app.row.querySelectorAll("button").find(button => button.textContent === englishInterfaceContent.t("setup.voice.test")).disabled,
    false, "device-default playback can still be tested");
  assert.equal(app.document.body.classList.contains("setup-blocked"), false);
  const retry = app.row.querySelectorAll("button").find(button => button.textContent === englishInterfaceContent.t("setup.voice.recheck"));
  assert.equal(retry.disabled, false);
  retry.click();
  await flush();
  result = available;
  await app.runTimer(250);
  assert.equal(app.row.dataset.ready, "true");
  assert.equal(app.warning.hidden, true);
});

test("voice readiness never releases the app-control barrier or overrides an app error", async t => {
  const app = mount(t, { controlsReady: false });
  await flush();
  assert.equal(app.row.dataset.ready, "true");
  assert.equal(app.document.documentElement.dataset.caatuuShellReady, "loading");
  assert.equal(app.document.body.classList.contains("setup-blocked"), true);
  assert.equal(app.card.classList.contains("is-ready"), false);
  assert.equal(app.title.textContent, englishInterfaceContent.t("setup.preparing"));
  app.card.classList.add("is-ready", "is-error");
  app.document.documentElement.dataset.caatuuShellReady = "true";
  app.title.textContent = "App failed";
  app.check.render();
  assert.equal(app.title.textContent, "App failed");
});

test("native voice status is checked and the voice row survives rebuilt setup artifacts", async t => {
  let nativeReady = false;
  const app = mount(t, { query: async () => ({ backend: "android", available: nativeReady, voices: [] }) });
  await flush();
  const row = app.row;
  app.artifacts.replaceChildren();
  app.check.render();
  assert.equal(app.row, row);
  nativeReady = true;
  app.window.dispatchEvent({ type: "caatuu:speech-voices-refresh" });
  await flush();
  assert.equal(app.row.dataset.ready, "true");
});

test("a hung voice query times out; late results cannot override a successful retry", async t => {
  let finish;
  const hanging = new Promise(resolve => { finish = resolve; });
  let result = hanging;
  const app = mount(t, { query: () => result });
  let validated = false;
  app.check.initialCheck.then(() => { validated = true; });
  await flush();
  assert.equal(validated, false, "readiness must wait for the initial voice query");
  await app.runTimer(4000);
  assert.equal(validated, true, "an unresponsive voice engine must not block startup forever");
  assert.equal(app.warning.hidden, false);
  result = Promise.resolve(available);
  await app.runTimer(250);
  assert.equal(app.row.dataset.ready, "true");
  finish(missing);
  await flush();
  assert.equal(app.row.dataset.ready, "true");
});

test("Test voice reports completion, mute, interruption and playback failure honestly", async t => {
  for (const result of [{ outcome: "completed" }, { muted: true }, { outcome: "stopped" }, new Error("engine failed")]) {
    const app = mount(t, { playback: async () => { if (result instanceof Error) throw result; return result; } });
    await flush();
    app.row.querySelectorAll("button").find(button => button.textContent === englishInterfaceContent.t("setup.voice.test")).click();
    await flush();
    assert.equal(app.plays, 1);
    const feedback = app.row.querySelector("p").textContent;
    if (result instanceof Error) {
      assert.equal(app.row.dataset.ready, "false");
      assert.equal(app.title.textContent, englishInterfaceContent.t("setup.readytitle"));
      assert.equal(app.warning.hidden, false);
    } else if (result.muted) assert.equal(feedback, englishInterfaceContent.t("speech.audio.mutednotice"));
    else assert.equal(feedback === englishInterfaceContent.t("setup.voice.testfinished"), result.outcome === "completed");
  }
});

test("disposing the check stops retries and ignores late voice results", async t => {
  let finish;
  const app = mount(t, { query: () => new Promise(resolve => { finish = resolve; }) });
  await flush();
  app.check.dispose();
  finish(available);
  await flush();
  app.changed();
  assert.equal(app.row.dataset.ready, "false");
  assert.equal(app.queries, 1);
  assert.equal(app.timers.size, 0);
});

test("successful game playback clears the warning even if voice enumeration stays empty", async t => {
  let result = missing;
  const app = mount(t, { query: async () => result });
  await flush();
  assert.equal(app.warning.hidden, false);
  result = { ...missing, playbackStatus: "confirmed" };
  app.window.dispatchEvent({ type: "caatuu:speech-playback-state" });
  await flush();
  assert.equal(app.row.dataset.ready, "true");
  assert.equal(app.warning.hidden, true);
  assert.equal(app.timers.size, 0);
  app.changed();
  await flush();
  assert.equal(app.warning.hidden, true, "refreshing an empty list must not erase successful playback");
  result = { ...missing, playbackStatus: "failed" };
  app.window.dispatchEvent({ type: "caatuu:speech-playback-state" });
  await flush();
  assert.equal(app.warning.hidden, false);
  assert.equal(app.row.dataset.status, "warning");
});

test("a voice test can confirm device-default speech with an empty list", async t => {
  const app = mount(t, { query: async () => missing });
  await flush();
  const button = app.row.querySelectorAll("button").find(button => button.textContent === englishInterfaceContent.t("setup.voice.test"));
  assert.equal(button.disabled, false);
  button.click();
  await flush();
  assert.equal(app.plays, 1);
  assert.equal(app.row.dataset.ready, "true");
  assert.equal(app.warning.hidden, true);
  assert.equal(app.timers.size, 0);
});

test("a pending enumeration cannot overwrite newer playback evidence", async t => {
  let finish;
  let result = new Promise(resolve => { finish = resolve; });
  const app = mount(t, { query: () => result });
  await flush();
  result = { ...missing, playbackStatus: "confirmed" };
  app.window.dispatchEvent({ type: "caatuu:speech-playback-state" });
  finish(missing);
  await flush();
  assert.equal(app.row.dataset.ready, "true");
  assert.equal(app.warning.hidden, true);
  assert.equal(app.timers.size, 0);
});
