import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { newContentEncounterId } from "../static/source/games/content-progression.mjs";
import { createReviewContinuation } from "../static/source/games/practice-pacing.mjs";
import { createMemoryMoonDictionary as createResultDictionary } from "../static/source/games/memory-moon/memory-moon-dictionary.mjs";

import { createBrowserHarness } from "./helpers/fake-browser.mjs";
import { createInterfaceContent } from "../static/source/interface-content.mjs";
import { appendTargetToneText } from "../static/source/target-text-tones.mjs";
import { createArabicReadingGuide } from "../static/source/arabic-reading-guide.mjs";
import { fetchDeclaredCourseGameJson, readEmbeddedCourseProfile } from "../static/source/games/course-game-content.mjs";
import { createSpeechIcon, mountEmbeddedGameControls, mountRobotLoadingScreen } from "../static/source/games/embedded-game-controls.mjs";
import { SOUND_QUASAR_ROUND_COUNT, createSoundQuasarSession, evaluateSoundQuasarChoice, validateSoundQuasarCatalog, soundQuasarItemsForDifficulty }
  from "../static/source/games/sound-quasar/sound-quasar-core.mjs";

const hostSource = await readFile(new URL("../static/source/games/sound-quasar/sound-quasar-host.mjs", import.meta.url), "utf8");
const gameMarkup = await readFile(new URL("../static/games/sound-quasar.html", import.meta.url), "utf8");
const learningProfileSource = await readFile(new URL("../static/source/learning-profile.js", import.meta.url), "utf8");
const interfaceContent = createInterfaceContent(JSON.parse(await readFile(new URL("../static/data/interface/en.v1.json", import.meta.url), "utf8")));

// Keep the actual document ancestry so delegated choice events, live controls,
// and focus after replacement are exercised without a separate DOM package.
function seedGameMarkup(harness) {
  const source = /<main\b[\s\S]*?<\/main>/u.exec(gameMarkup)?.[0];
  assert.ok(source, "the shared game must expose a main landmark");
  const stack = [harness.document.body];
  const voidTags = new Set(["img", "input", "br", "hr", "source", "wbr"]);
  for (const token of source.match(/<!--[^]*?-->|<[^>]+>|[^<]+/gu) || []) {
    if (token.startsWith("<!--")) continue;
    if (token.startsWith("</")) { stack.pop(); continue; }
    if (!token.startsWith("<")) { stack.at(-1).append(token); continue; }
    const [, tag, attributes] = /^<([\w-]+)\b([^]*)>$/u.exec(token);
    const node = harness.document.createElement(tag);
    for (const [, name, value] of attributes.matchAll(/([:\w-]+)(?:="([^"]*)")?/gu)) {
      node.setAttribute(name, value ?? "");
    }
    stack.at(-1).append(node);
    if (!voidTags.has(tag) && !token.endsWith("/>")) stack.push(node);
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

async function settle() {
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
}

function createTestClock() {
  let now = 0;
  let nextId = 1;
  const pending = new Map();
  const scheduled = [];
  const clock = {
    setTimeout(callback, delay = 0) {
      const timer = { id: nextId++, callback, delay, due: now + delay };
      pending.set(timer.id, timer);
      scheduled.push(timer);
      return timer.id;
    },
    clearTimeout(id) { pending.delete(id); },
    pending: () => [...pending.values()].sort((left, right) => left.due - right.due),
    latest: () => scheduled.at(-1),
    async advance(milliseconds = clock.pending()[0]?.due - now) {
      assert.ok(Number.isFinite(milliseconds) && milliseconds >= 0, "advancing needs a pending timer or an explicit nonnegative duration");
      const until = now + milliseconds;
      let runs = 0;
      while (clock.pending()[0]?.due <= until) {
        assert.ok(++runs < 100, "timers must not loop without advancing time");
        const timer = clock.pending()[0];
        pending.delete(timer.id);
        now = timer.due;
        timer.callback();
        await settle();
      }
      now = until;
      await settle();
    }
  };
  return clock;
}

async function mountGame({ language = "mandarin-simplified", muted = true, voiceState,
  speechResult = { outcome: "completed" }, fetchFailure = false, reportResult = { queued: true, persisted: true },
  realLearning = false, difficulty = 1, modeOverride = "words", settingsApi = true,
  onRecord, mutateCatalog, random = () => 0, localStorageValues = {}, interfaceOverride, beforeContent, resolveWord } = {}) {
  const raw = JSON.parse(await readFile(new URL(`../../languages/${language}/static/data/games/sound-quasar/content.json`, import.meta.url), "utf8"));
  mutateCatalog?.(raw);
  const catalog = validateSoundQuasarCatalog(raw);
  const declaredCourse = JSON.parse(await readFile(new URL(`../../languages/${language}/course.json`, import.meta.url), "utf8"));
  const course = {
    id: catalog.courseId,
    routePrefix: `/${catalog.courseId}`,
    sourceLanguage: { id: catalog.learnerBaseLanguage.split("-")[0], locale: catalog.learnerBaseLanguage, direction: declaredCourse.sourceLanguage.direction },
    targetLanguage: { id: catalog.targetLanguageId, locale: catalog.audio.locale, direction: declaredCourse.targetLanguage.direction },
    storage: { namespace: `caatuu-${catalog.courseId}`, learningPerformance: `caatuu-${catalog.courseId}.learning.performance.v1` },
    capabilities: { speech: true },
    gameContent: { "sound-quasar": { soundQuasarCatalog: "data/games/sound-quasar/content.json?v=test-1" } }
  };
  course.courseSelector = { courses: [{ id: course.id, sourceLanguage: course.sourceLanguage,
    targetLanguage: course.targetLanguage, storage: course.storage }] };
  const parent = createBrowserHarness({ course, localStorageValues });
  const harness = createBrowserHarness({ course, location: {
    href: "https://caatuu.test/language-runtime/static/games/sound-quasar.html"
  } });
  const clock = createTestClock();
  harness.window.setTimeout = clock.setTimeout;
  harness.window.clearTimeout = clock.clearTimeout;
  seedGameMarkup(harness);
  harness.document.querySelectorAll = (selector) => harness.registry.querySelectorAll(selector).filter((node) => node.isConnected);
  harness.document.querySelector = (selector) => harness.document.querySelectorAll(selector)[0] || null;
  const shell = parent.window;
  const records = [];
  const messages = [];
  const speechCalls = [];
  const fetchCalls = [];
  const reports = [];
  let reportOutcome = reportResult;
  const preferences = { muted, pace: "normal", voice: "", stops: 0, voiceChecks: 0 };
  let audioResult = speechResult;
  let voices = voiceState ?? { available: true, backend: "browser", voices: [
    { name: "Fixture voice", value: `browser:${catalog.audio.locale}`, locale: catalog.audio.locale }
  ] };
  shell.CaatuuI18n = interfaceOverride || interfaceContent;
  shell.CaatuuRuntime = { maintenance: { async enqueueReport(payload, options) {
    reports.push({ payload, options });
    return typeof reportOutcome === "function" ? reportOutcome() : reportOutcome;
  } } };
  if (realLearning) vm.runInContext(learningProfileSource, parent.context, { filename: "learning-profile.js" });
  const learning = shell.CaatuuLearning;
  // Most scenarios retain Explorer; callers can exercise the same controls at zero.
  if (realLearning && !Object.hasOwn(localStorageValues, `${course.storage.namespace}.learning.preferences.v1`)) {
    learning.setDifficulty(difficulty);
  }
  // Existing listening scenarios explicitly exercise words. New default-setting
  // scenarios leave this null and use the real learner preference API untouched.
  if (realLearning && modeOverride) learning.setGameSetting("soundMode", modeOverride);
  const fixtureSettings = { soundChoices: [4, 4, 6, 6][difficulty],
    soundMode: modeOverride || (difficulty === 0 ? "words" : "sentences") };
  const settingMethods = settingsApi ? {
    gameSetting: learning?.gameSetting || (name => fixtureSettings[name]),
    setGameSetting: learning?.setGameSetting || ((name, value) => { fixtureSettings[name] = value; })
  } : {};
  shell.CaatuuLearning = { ...learning, difficulty: learning?.difficulty || (() => difficulty), ...settingMethods, record: (...args) => {
    records.push(JSON.parse(JSON.stringify(args)));
    onRecord?.({ shell, harness, args, clock });
    return learning?.record(...args);
  } };
  shell.postMessage = (message, origin) => messages.push({ message, origin });
  shell.CaatuuChrome = {
    applyTheme(value) { shell.document.documentElement.dataset.theme = value; },
    applyFontSize(value) { shell.document.documentElement.dataset.fontSize = value; },
    getSpeechMuted: () => preferences.muted,
    setSpeechMuted(value) {
      preferences.muted = value;
      shell.dispatchEvent({ type: "caatuu:speech-mute-change" });
    },
    resolveSpeechPace: () => ({ key: preferences.pace, label: preferences.pace, rate: 1 }),
    setSpeechPacePreference(value) { preferences.pace = value; },
    getSpeechVoicePreference: () => preferences.voice,
    setSpeechVoicePreference(value) { preferences.voice = value; },
    stopSpeech() { preferences.stops += 1; },
    async getSpeechVoiceControlState() { preferences.voiceChecks += 1; return voices; },
    describeSpeechVoiceState: (state) => state.available ? "Voice ready" : "No voice available",
    async speakText(text, options) { speechCalls.push({ text, options }); return audioResult; }
  };
  harness.window.parent = shell;
  Object.assign(harness.context, {
    createReviewContinuation,
    createResultDictionary, testServices: { resolveWord },
    newContentEncounterId,
    createArabicReadingGuide,
    fetchDeclaredCourseGameJson, readEmbeddedCourseProfile, createSpeechIcon,
    mountEmbeddedGameControls, mountRobotLoadingScreen, createSoundQuasarSession, evaluateSoundQuasarChoice,
    validateSoundQuasarCatalog, soundQuasarItemsForDifficulty, appendTargetToneText, testRandom: random,
    fetch: async (url) => {
      fetchCalls.push(url);
      await beforeContent?.({ harness, shell, clock, speechCalls, records });
      return { ok: !fetchFailure, status: fetchFailure ? 503 : 200, json: async () => raw };
    }
  });
  const executable = hostSource
    .replace(/^import\s+[\s\S]*?\sfrom\s+["'][^"']+["'];\r?\n/gmu, "")
    .replace(/\bexport async function /gu, "async function ")
    .replace(/if \(typeof document !== "undefined"\) mountSharedSoundQuasar\(\)\.catch\(showError\);/u, "");
  vm.runInContext(executable, harness.context, { filename: "sound-quasar-host.mjs" });
  const controller = await vm.runInContext("mountSharedSoundQuasar({ scope: window, fetchImpl: fetch, random: testRandom, services: testServices })", harness.context);
  await settle();
  const element = (name) => harness.document.getElementById(`quasar${name}`);
  const choices = () => element("Choices").querySelectorAll("button[data-choice-id]");
  function click(node) {
    assert.ok(node?.isConnected, "the requested control must exist in the live document");
    assert.equal(node.disabled, false, "the requested control must be enabled");
    node.focus();
    node.click();
  }
  async function listen() { click(element("Listen")); await settle(); }
  const current = () => [...catalog.items, ...(catalog.sentences || [])].find((item) => item.target === speechCalls.at(-1)?.text);
  const choice = (id) => choices().find((node) => node.dataset.choiceId === id);
  const noCampaign = () => {
    assert.equal(messages.filter(({ message }) => message.type === "round-success").length, 0);
  };
  const noCredit = () => {
    assert.equal(records.length, 0, "listening, controls, and reports alone cannot earn rewards");
    noCampaign();
  };
  return { ...harness, parent, shell, course, catalog, controller, element, choices, choice,
    current, click, listen, records, messages, speechCalls, fetchCalls, preferences, noCredit, noCampaign, reports,
    clock, advance: clock.advance,
    async continue() { click(element("Continue")); await settle(); },
    setReportResult(value) { reportOutcome = value; },
    setVoiceState(value) { voices = value; }, setSpeechResult(value) { audioResult = value; } };
}

test("Arabic listening keeps target phrases RTL and the English result LTR", async () => {
  const game = await mountGame({ language: "arabic-standard" });
  assert.equal(game.document.documentElement.dir, "ltr");
  for (const choice of game.choices()) {
    const target = choice.querySelector(".quasar-choice-target");
    assert.equal(target.dir, "rtl");
    assert.equal(target.lang, "ar");
  }
  await game.listen();
  game.click(game.choice(game.current().id));
  assert.equal(game.element("ResultTarget").dir, "rtl");
  assert.ok(game.element("ResultTarget").querySelector("rt"));
  game.document.querySelector('[data-arabic-romanization-setting="sound-quasar"]').click();
  assert.equal(game.element("ResultTarget").textContent, game.current().target);
  assert.equal(game.element("ResultMeaning").dir, "ltr");
  game.controller.destroy();
});

test("Arabic listening can hide and restore readings without changing choices, progress or speech", async () => {
  const game = await mountGame({ language: "arabic-standard" });
  const choices = game.choices().map(choice => choice.dataset.choiceId);
  const progress = game.element("Progress").textContent;
  assert.ok(game.choices().every(choice => choice.querySelector("rt")));
  const toggle = game.document.querySelector('[data-arabic-romanization-setting="sound-quasar"]');
  toggle.click();
  assert.ok(game.choices().every(choice => !choice.querySelector("rt")));
  assert.equal(game.element("Progress").textContent, progress);
  assert.deepEqual(game.choices().map(choice => choice.dataset.choiceId), choices);
  assert.equal(game.speechCalls.length, 0);
  toggle.click();
  assert.ok(game.choices().every(choice => choice.querySelector("rt")));
  game.noCredit();
  game.controller.destroy();
});

test("listening distinguishes the first unaided attempt from correction without inflating exposure", async () => {
  const game = await mountGame({ realLearning: true });
  const history = () => game.shell.CaatuuLearning.contentHistory("sound-quasar", "words");
  assert.equal(Object.keys(history()).length, 0);
  await game.listen();
  const id = game.current().id;
  assert.equal(Object.keys(history()).length, 0);
  const wrong = game.choices().find(button => button.dataset.choiceId !== id);
  game.click(wrong);
  assert.equal(history()[id].exposures, 1);
  assert.equal(history()[id].lastEvidence, "independent");
  assert.equal(history()[id].lastCorrect, false);
  const answer = game.choice(id);
  game.click(answer);
  assert.equal(history()[id].exposures, 1);
  assert.equal(history()[id].lastCorrect, false, "the assisted correction retains its failed first attempt for review");
  assert.equal(history()[id].lastEvidence, "assisted");
  assert.equal(history()[id].independentSuccesses, 0);
  assert.equal(history()[id].assistedSuccesses, 1);
  answer.click();
  assert.equal(history()[id].exposures, 1);
  assert.equal(Object.keys(history()).length, 1, "distractors earn no exposure");
  game.controller.destroy();
});

test("a listening exercise shown before reset cannot add exposure to the new generation", async () => {
  const game = await mountGame({ realLearning: true });
  const learning = game.shell.CaatuuLearning;
  const before = learning.contentGeneration();
  await game.listen();
  const staleId = game.current().id;
  learning.resetProgress();
  assert.notEqual(learning.contentGeneration(), before);
  game.click(game.choice(staleId));
  assert.equal(Object.keys(learning.contentHistory("sound-quasar", "words")).length, 0);
  await game.continue();
  await game.listen();
  const freshId = game.current().id;
  game.click(game.choice(freshId));
  assert.equal(learning.contentHistory("sound-quasar", "words")[freshId].exposures, 1);
  game.controller.destroy();
});

test("Spanish-base listening renders Spanish results and speaks only its English targets", async () => {
  const { createInterfaceContent } = await import("../static/source/interface-content.mjs");
  const spanish = createInterfaceContent(JSON.parse(await readFile(
    new URL("../static/data/interface/es.v1.json", import.meta.url), "utf8"
  )));
  const game = await mountGame({ language: "english-from-spanish", interfaceOverride: spanish });
  assert.equal(game.element("Listen").getAttribute("aria-label"), spanish.t("soundquasar.listen"));
  await game.listen();
  const answer = game.current();
  assert.ok(answer);
  game.click(game.choice(answer.id));
  await settle();
  assert.equal(game.element("ResultMeaning").textContent, answer.meaning);
  assert.equal(game.element("ResultMeaning").lang, "es-ES");
  assert.equal(game.element("ResultTarget").textContent, answer.target);
  assert.equal(game.element("ResultTarget").lang, "en-US");
  assert.equal(game.speechCalls[0].text, answer.target);
  assert.notEqual(answer.meaning, answer.englishAuditText);
  game.controller.destroy();
});

for (const language of ["czech", "mandarin-simplified", "spanish"]) {
  test(`${language} loads its declared words without autoplay and waits for a completed listen`, async () => {
    const game = await mountGame({ language });
    assert.equal(game.element("Game").hidden, false);
    assert.equal(game.element("Loading").hidden, true);
    assert.equal(game.element("Transition").hidden, true);
    assert.equal(game.speechCalls.length, 0, "opening the game never starts audio");
    assert.equal(game.element("AudioStatus").textContent, "", "a ready voice does not add device details to the game");
    assert.equal(game.fetchCalls.length, 1);
    assert.equal(new URL(game.fetchCalls[0]).pathname, `${game.course.routePrefix}/data/games/sound-quasar/content.json`);
    assert.equal(game.choices().length, 4);
    assert.ok(game.choices().every((button) => button.disabled));
    assert.ok(game.element("Controls").querySelector('[aria-label="Audio settings"]'));
    await game.listen();
    assert.ok(game.current(), "shared speech receives an authored target word");
    assert.ok(game.choices().every((button) => !button.disabled));
    for (const button of game.choices()) {
      assert.equal(button.querySelector(".quasar-choice-target").textContent, game.catalog.items.find(({ id }) => id === button.dataset.choiceId).target);
      assert.equal(button.lang, game.course.targetLanguage.locale);
      if (language === "mandarin-simplified") {
        assert.ok(button.querySelectorAll(".caatuu-target-tone").length > 0, "Mandarin word choices retain their pinyin tone coloring");
      } else assert.equal(button.querySelectorAll(".caatuu-target-tone").length, 0);
    }
    game.noCredit();
    game.controller.destroy();
  });
}

test("speech must finish before choices unlock and stopping prevents a stale completion from unlocking them", async () => {
  const playback = deferred();
  const game = await mountGame({ speechResult: playback.promise });
  await game.listen();
  assert.equal(game.speechCalls.length, 1);
  assert.ok(game.choices().every((button) => button.disabled));
  game.choices()[0].click();
  game.document.dispatchEvent({ type: "keydown", key: "1" });
  game.noCredit();
  assert.equal(game.element("Result").hidden, true, "an unfinished first listen cannot accept an answer");
  assert.equal(game.element("Listen").getAttribute("aria-pressed"), "true");
  const stops = game.preferences.stops;
  game.click(game.element("Listen"));
  await settle();
  assert.ok(game.preferences.stops > stops);
  playback.resolve({ outcome: "completed" });
  await settle();
  assert.ok(game.choices().every((button) => button.disabled));
  assert.equal(game.element("Listen").getAttribute("aria-pressed"), "false");
  game.setSpeechResult({ outcome: "completed" });
  await game.listen();
  assert.ok(game.choices().every((button) => !button.disabled));
  game.noCredit();
  game.controller.destroy();
});

for (const lateOutcome of ["completed", "rejected"]) {
  test(`answering during replay stops it once and ignores its late ${lateOutcome} outcome`, async () => {
    const game = await mountGame({ realLearning: true });
    await game.listen();
    const item = game.current();
    const replay = deferred();
    game.setSpeechResult(replay.promise);
    await game.listen();
    assert.equal(game.element("Listen").getAttribute("aria-pressed"), "true");
    assert.ok(game.choices().every(button => !button.disabled), "replay cannot relock an already heard question");
    const stops = game.preferences.stops;
    const correct = game.choice(item.id);
    game.click(correct);
    assert.equal(game.preferences.stops, stops + 1, "accepting the answer stops replay synchronously");
    assert.equal(game.element("Result").hidden, false);
    assert.equal(game.element("Continue").disabled, false);
    assert.equal(game.element("Listen").getAttribute("aria-pressed"), "false");
    correct.click();
    game.document.dispatchEvent({ type: "keydown", key: String(game.choices().indexOf(correct) + 1) });
    assert.equal(game.records.length, 1, "a duplicate click cannot record the answer twice");
    assert.equal(game.shell.CaatuuLearning.contentHistory("sound-quasar", "words")[item.id].exposures, 1);
    const progress = game.element("Progress").textContent;
    if (lateOutcome === "rejected") replay.reject(new Error("Obsolete replay failure"));
    else replay.resolve({ outcome: "completed" });
    await settle();
    assert.equal(game.records.length, 1);
    assert.equal(game.preferences.stops, stops + 1);
    assert.equal(game.element("Result").hidden, false);
    assert.equal(game.element("Listen").getAttribute("aria-pressed"), "false");
    assert.equal(game.element("Progress").textContent, progress, "the answer still waits for Continue");
    assert.equal(game.element("AudioStatus").textContent, "");
    game.controller.destroy();
  });
}

test("a wrong answer interrupts replay and leaves the correction immediately available", async () => {
  const game = await mountGame({ realLearning: true });
  await game.listen();
  const item = game.current();
  const replay = deferred();
  game.setSpeechResult(replay.promise);
  await game.listen();
  const wrong = game.choices().find(button => button.dataset.choiceId !== item.id);
  const stops = game.preferences.stops;
  game.click(wrong);
  assert.equal(game.preferences.stops, stops + 1);
  assert.equal(wrong.disabled, true);
  assert.equal(game.choice(item.id).disabled, false);
  wrong.click();
  assert.equal(game.records.length, 1);
  game.click(game.choice(item.id));
  assert.equal(game.records.length, 2, "correction does not wait for a never-settled replay");
  assert.equal(game.shell.CaatuuLearning.contentHistory("sound-quasar", "words")[item.id].exposures, 1);
  replay.resolve({ outcome: "completed" });
  await settle();
  assert.equal(game.element("Result").hidden, false);
  assert.ok(game.choices().every(button => button.disabled));
  game.controller.destroy();
});

for (const blockedBy of ["report", "controls", "hidden document", "inactive panel", "pagehide", "game dynamics"]) {
  test(`replay cannot accept answers while blocked by ${blockedBy}`, async () => {
    const game = await mountGame();
    await game.listen();
    const correct = game.choice(game.current().id);
    const replay = deferred();
    game.setSpeechResult(replay.promise);
    await game.listen();
    if (blockedBy === "report") game.click(game.element("Report"));
    else if (blockedBy === "controls") game.click(game.element("Controls").querySelector('[aria-label="Audio settings"]'));
    else if (blockedBy === "hidden document") game.shell.document.visibilityState = "hidden";
    else if (blockedBy === "inactive panel") game.window.dispatchEvent({ type: "message", origin: game.window.location.origin, source: game.shell,
      data: { source: "caatuu-app-shell", type: "visibility", active: false } });
    else if (blockedBy === "pagehide") game.window.dispatchEvent({ type: "pagehide", persisted: true });
    else game.shell.CaatuuGameDynamics = { active: true };
    correct.click();
    replay.resolve({ outcome: "completed" });
    await settle();
    game.noCredit();
    assert.equal(game.element("Result").hidden, true);
    game.controller.destroy();
  });
}

test("shell difficulty changes reset a hidden listening round and ignore stale audio", async () => {
  const playback = deferred();
  const game = await mountGame({ speechResult: playback.promise, realLearning: true });
  await game.listen();
  const oldChoices = game.choices();
  game.window.dispatchEvent({ type: "message", origin: game.window.location.origin, source: game.shell,
    data: { source: "caatuu-app-shell", type: "visibility", active: false } });
  game.shell.CaatuuLearning.setDifficulty(2);
  await settle();
  assert.ok(oldChoices.every((button) => !button.isConnected));
  assert.equal(game.element("Result").hidden, true);
  playback.resolve({ outcome: "completed" });
  await settle();
  assert.ok(game.choices().every((button) => button.disabled), "the new round still requires its own listen");
  game.noCredit();
  game.controller.destroy();
});

test("an insufficient listening band retires its board without a retry loop and recovers through another badge", async () => {
  const game = await mountGame({ realLearning: true, mutateCatalog(raw) {
    for (const bank of [raw.items, raw.sentences]) {
      const last = bank.find(item => item.difficulty === 3);
      bank.forEach(item => { if (item.difficulty === 3 && item !== last) item.difficulty = 1; });
    }
  } });
  game.shell.CaatuuLearning.setDifficulty(3);
  await settle();
  assert.equal(game.element("Game").hidden, true);
  assert.equal(game.element("Error").hidden, false);
  assert.equal(game.choices().length, 0);
  assert.equal(game.clock.pending().length, 0);
  game.shell.CaatuuLearning.setDifficulty(2);
  await settle();
  assert.equal(game.element("Game").hidden, false);
  assert.equal(game.element("Error").hidden, true);
  const ids = new Set(game.catalog.sentences.filter(item => item.difficulty === 2).map(item => item.id));
  assert.ok(game.choices().length >= 2 && game.choices().every(button => ids.has(button.dataset.choiceId)));
  game.noCredit();
  game.controller.destroy();
});

test("the listening host uses the selected course difficulty for both answers and choices", async () => {
  const game = await mountGame({ language: "english-from-spanish", realLearning: true });
  for (const difficulty of [1, 2, 3]) {
    game.shell.CaatuuLearning.setDifficulty(difficulty);
    await settle();
    const bank = game.element("Game").dataset.mode === "words" ? game.catalog.items : game.catalog.sentences;
    const eligible = new Set(bank.filter(row => row.difficulty === difficulty).map(row => row.id));
    assert.ok(game.choices().every(button => eligible.has(button.dataset.choiceId)));
    await game.listen();
    assert.ok(eligible.has(game.current().id));
  }
  game.noCredit();
  game.controller.destroy();
});

test("wrong answers keep the choices while correct answers show a result before advancing", async () => {
  const game = await mountGame();
  await game.listen();
  const correct = game.choice(game.current().id);
  const wrong = game.choices().find((button) => button !== correct);
  game.click(wrong);
  assert.equal(game.element("Feedback").textContent, interfaceContent.t("soundquasar.tryagain"));
  assert.equal(wrong.classList.contains("is-wrong"), true);
  assert.equal(wrong.disabled, true);
  assert.equal(correct.disabled, false);
  assert.equal(game.element("Result").hidden, true);
  assert.equal(game.clock.pending().length, 0, "a wrong attempt must not start a transition");
  game.click(correct);
  assert.deepEqual(game.records, [
    ["sound-quasar", { activities: 1, attempts: 1, successes: 0, xp: 0 }],
    ["sound-quasar", { activities: 1, attempts: 1, successes: 1, xp: 1 }]
  ], "a correct retry earns exactly one XP");
  assert.equal(game.element("Result").hidden, false);
  assert.equal(game.element("AnswerArea").classList.contains("is-result"), true);
  assert.equal(game.element("Choices").getAttribute("aria-hidden"), "true");
  assert.ok(game.choices().every((button) => button.disabled));
  assert.equal(game.element("ResultTarget").textContent, game.current().target);
  assert.equal(game.element("ResultMeaning").textContent, game.current().meaning);
  assert.equal(game.element("ResultStatus").textContent, "Correct");
  assert.ok(game.element("ResultTarget").querySelectorAll(".caatuu-target-tone").length > 0);
  assert.equal(game.speechCalls.length, 1, "solving never autoplays the next word");
  assert.equal(game.choice(game.current().id), correct, "solving never automatically changes the question");
  await game.continue();
  assert.ok(game.choices().every((button) => button.disabled));
  assert.equal(game.speechCalls.length, 1);
  assert.equal(correct.isConnected, false);
  game.noCampaign();
  game.controller.destroy();
});

for (const mode of ["Words", "Sentences"]) for (const count of [4, 6]) {
  test(`${mode} with ${count} options shows the correct answer after two mistakes and advances without XP`, async () => {
    const game = await mountGame();
    game.click(game.element(mode));
    game.click(game.element(count === 6 ? "SixChoices" : "FourChoices"));
    await game.listen();
    const item = game.current();
    const artwork = game.element("Emblem").src;
    const mistakes = game.choices().filter((button) => button.dataset.choiceId !== item.id);
    game.click(mistakes[0]);
    assert.equal(game.element("Result").hidden, true);
    mistakes[0].click();
    assert.equal(game.records.length, 1, "repeating the disabled answer does not consume the second attempt");
    game.click(mistakes[1]);
    assert.equal(game.element("Result").hidden, false);
    assert.equal(game.element("Result").dataset.tone, "error");
    assert.equal(game.element("ResultStatus").textContent, "Correct answer");
    assert.equal(game.element("ResultTarget").textContent, item.target);
    assert.equal(game.element("ResultMeaning").textContent, item.meaning);
    assert.equal(game.element("Emblem").src, artwork);
    assert.equal(game.element("Choices").getAttribute("aria-hidden"), "true");
    assert.ok(game.choices().every((button) => button.disabled));
    game.choice(item.id).click();
    assert.equal(game.records.length, 2);
    await game.continue();
    assert.equal(game.element("Result").hidden, true);
    assert.ok(game.choices().every((button) => !button.classList.contains("is-wrong")));
    assert.equal(game.records.reduce((sum, [, delta]) => sum + (delta.xp || 0), 0), 0);
    assert.equal(game.records.filter(([, delta]) => delta.rounds).length, 0);
    game.controller.destroy();
  });
}

test("an entirely missed session gives no XP, coin, or streak qualification", async () => {
  const game = await mountGame();
  for (let round = 0; round < SOUND_QUASAR_ROUND_COUNT; round += 1) {
    await game.listen();
    const mistakes = game.choices().filter((button) => button.dataset.choiceId !== game.current().id);
    game.click(mistakes[0]);
    game.click(mistakes[1]);
    await game.continue();
  }
  assert.equal(game.element("Transition").hidden, true);
  assert.equal(game.records.length, 2 * SOUND_QUASAR_ROUND_COUNT);
  assert.ok(game.records.every(([, delta]) => delta.xp === 0 && !delta.rounds && !delta.streakEligible));
  game.controller.destroy();
});

test("three manual continuations earn answer XP and one round, then start the next ready batch", async () => {
  const game = await mountGame();
  const answered = new Set();
  for (let index = 0; index < SOUND_QUASAR_ROUND_COUNT; index += 1) {
    await game.listen();
    const item = game.current();
    assert.equal(answered.has(item.id), false, "a session does not repeat an answer");
    answered.add(item.id);
    if (index === 0) {
      game.click(game.choices().find((button) => button.dataset.choiceId !== item.id));
      game.click(game.choice(item.id));
    } else if (index === 1) {
      game.click(game.element("Skip")); await game.continue();
      continue;
    } else game.click(game.choice(item.id));
    await game.continue();
  }
  assert.equal(game.element("Transition").hidden, true);
  assert.equal(game.element("Summary"), null);
  assert.equal(game.records.filter(([, delta]) => delta.attempts).length, SOUND_QUASAR_ROUND_COUNT);
  assert.equal(game.records.reduce((sum, [, delta]) => sum + (delta.xp || 0), 0), SOUND_QUASAR_ROUND_COUNT - 1);
  assert.deepEqual(game.records.filter(([, delta]) => delta.rounds), [["sound-quasar", { rounds: 1, streakEligible: true }]]);
  const recordsBeforeRestart = structuredClone(game.records);
  game.element("Continue").click();
  await game.advance(10000);
  assert.deepEqual(game.records, recordsBeforeRestart, "a duplicate Finish event cannot count the round twice");
  game.noCampaign();
  assert.equal(game.element("Restart"), null);
  assert.equal(game.element("Transition").hidden, true);
  assert.ok(game.choices().every((button) => button.disabled));
  assert.equal(game.speechCalls.length, SOUND_QUASAR_ROUND_COUNT);
  assert.deepEqual(game.records, recordsBeforeRestart, "restarting does not reward an unplayed session");
  game.noCampaign();
  game.controller.destroy();
});

test("the final Continue retains sentence mode and six options without a forced loader", async () => {
  const game = await mountGame();
  game.click(game.element("Sentences"));
  game.click(game.element("SixChoices"));
  for (let index = 0; index < SOUND_QUASAR_ROUND_COUNT; index += 1) { game.click(game.element("Skip")); await game.continue(); }
  assert.equal(game.element("Transition").hidden, true);
  assert.match(game.element("Robot").src, /^\/assets\/robots\//u);
  assert.equal(game.element("Transition").classList.contains("caatuu-game-robot-loading"), true);
  assert.equal(game.element("Robot").classList.contains("caatuu-game-robot-loading-art"), true);
  assert.equal(game.element("Robot").src, game.element("Loading").querySelector("img").src);
  assert.equal(game.fetchCalls.length, 1, "the shared robot does not request a private asset catalog");
  await game.advance(1199);
  assert.equal(game.element("Transition").hidden, true);
  await game.advance(1);
  assert.equal(game.element("Transition").hidden, true);
  assert.equal(game.element("Game").dataset.mode, "sentences");
  assert.equal(game.choices().length, 6);
  assert.equal(game.element("Progress").textContent, "Sentence 1 of 3");
  assert.ok(game.choices().every((button) => button.disabled));
  game.noCredit();
  game.controller.destroy();
});

test("continued listening batches introduce fresh easy targets without earning same-day spaced credit", async (t) => {
  const now = Date.parse("2026-09-19T12:00:00.000Z");
  t.mock.method(Date, "now", () => now);
  class SameDayDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const fixtureBank = (mode) => Array.from({ length: 32 }, (_, index) => {
    const id = `fixture-${mode}-${String(index).padStart(2, "0")}`;
    return { id, revision: "fixture-v1", target: `${mode} target ${index}`,
      meaning: `Fixture meaning ${index}`, englishAuditText: `Fixture meaning ${index}`,
      sourceId: id, sourceReviewStatus: "pending", usefulness: 75,
      difficulty: index < 28 ? 1 : 2, complexity: index < 24 || index >= 28 ? 10 : 90 };
  });
  const game = await mountGame({ realLearning: true, mutateCatalog(raw) {
    raw.items = fixtureBank("words");
    raw.provenance.sourceItemIds = raw.items.map(item => item.sourceId);
    raw.sentences = fixtureBank("sentences");
    raw.sentenceProvenance.sourceItemIds = raw.sentences.map(item => item.sourceId);
  } });
  game.parent.context.Date = SameDayDate;
  const history = mode => JSON.parse(JSON.stringify(game.shell.CaatuuLearning.contentHistory("sound-quasar", mode)));
  const completedHistories = {};
  try {
    for (const [mode, choiceCount] of [["words", 4], ["sentences", 6]]) {
      if (mode === "sentences") {
        game.click(game.element("Sentences"));
        game.click(game.element("SixChoices"));
      }
      assert.deepEqual(history(mode), {}, "changing mode must not borrow another mode's listening evidence");
      const bank = mode === "words" ? game.catalog.items : game.catalog.sentences;
      const byId = new Map(bank.map(item => [item.id, item]));
      const seen = new Set();
      for (let batch = 0; batch < 8; batch += 1) {
        const before = history(mode);
        const rotation = Object.values(before).reduce((sum, progress) => sum + progress.exposures, 0) % 5;
        const answers = [];
        for (let index = 0; index < SOUND_QUASAR_ROUND_COUNT; index += 1) {
          await game.listen();
          const item = game.current();
          assert.ok(byId.has(item.id), "the answer must belong to the selected mode");
          assert.equal(item.difficulty, 1);
          assert.equal(item.complexity, 10, "same-day repetition cannot widen the challenge frontier");
          assert.equal(answers.includes(item.id), false, "a batch must have distinct answers");
          answers.push(item.id);
          seen.add(item.id);
          const options = game.choices().map(button => byId.get(button.dataset.choiceId));
          assert.equal(options.length, choiceCount);
          assert.ok(options.every(option => option && option.difficulty === 1 && option.complexity === 10));
          assert.equal(new Set(options.map(option => option.id)).size, choiceCount);
          assert.equal(new Set(options.map(option => option.target)).size, choiceCount);
          assert.equal(options.filter(option => option.id === item.id).length, 1);
          game.click(game.choice(item.id));
          await game.continue();
        }
        const newIndexes = answers.flatMap((id, index) => before[id] ? [] : [index]);
        if (Object.keys(before).length >= 6) {
          const introductionSlots = answers.flatMap((_, index) => (rotation + index) % 5 === 2 ? [index] : []);
          assert.deepEqual(newIndexes, introductionSlots, "short batches preserve the five-slot new-material cadence across sessions");
        }
        assert.equal(game.element("Transition").hidden, true, "the final Continue starts the next ready batch");
        assert.equal(game.element("Game").dataset.mode, mode);
        assert.equal(game.choices().length, choiceCount);
      }
      assert.ok(seen.size > 6, "continued listening must progress beyond the initial six targets");
      const progress = history(mode);
      assert.deepEqual(new Set(Object.keys(progress)), seen, "distractors and unplayed next-batch items earn no exposure");
      assert.equal(Object.values(progress).reduce((sum, item) => sum + item.exposures, 0), 8 * SOUND_QUASAR_ROUND_COUNT);
      assert.ok(Object.values(progress).some(item => item.exposures > 1), "introductions stay mixed with practice");
      for (const item of Object.values(progress)) {
        assert.equal(item.independentSuccesses, item.exposures);
        assert.equal(item.spacedSuccesses, 0);
        assert.equal(item.independentDays, 1);
        assert.equal(item.practiceDays, 1);
        assert.equal(item.intervalMs, 24 * 60 * 60 * 1000);
      }
      completedHistories[mode] = progress;
      assert.deepEqual(history("words"), completedHistories.words, "sentence practice must leave word history intact");
    }
    const restored = createBrowserHarness({ course: game.course, localStorageValues: game.parent.localStorage.snapshot() });
    restored.context.Date = SameDayDate;
    vm.runInContext(learningProfileSource, restored.context, { filename: "learning-profile.js" });
    for (const mode of ["words", "sentences"]) {
      assert.deepEqual(JSON.parse(JSON.stringify(restored.window.CaatuuLearning.contentHistory("sound-quasar", mode))),
        completedHistories[mode], "actual listening evidence must survive a reload in its own bank");
    }
  } finally {
    game.controller.destroy();
  }
});

for (const reason of ["hidden", "inactive", "destroyed"]) {
  test(`a ${reason} game cannot consume its pending final Continue`, async () => {
    const game = await mountGame();
    const visibility = (active) => game.window.dispatchEvent({ type: "message", origin: "https://caatuu.test", source: game.shell,
      data: { source: "caatuu-app-shell", type: "visibility", active } });
    for (let index = 0; index < 4; index += 1) { game.click(game.element("Skip")); await game.continue(); }
    game.click(game.element("Skip"));
    const continuation = game.element("Continue");
    if (reason === "hidden") {
      game.shell.document.visibilityState = "hidden";
      game.shell.document.dispatchEvent({ type: "visibilitychange" });
    } else if (reason === "inactive") visibility(false);
    else game.controller.destroy();
    continuation.click();
    await game.advance(5000);
    assert.equal(game.element("Transition").hidden, true);
    assert.equal(game.speechCalls.length, 0);
    if (reason !== "destroyed") {
      if (reason === "hidden") {
        game.shell.document.visibilityState = "visible";
        game.shell.document.dispatchEvent({ type: "visibilitychange" });
      } else { visibility(true); await settle(); }
      assert.equal(game.element("Result").hidden, false);
      await game.continue();
      assert.equal(game.element("Transition").hidden, true);
    }
    game.noCredit();
    game.controller.destroy();
  });
}

test("a campaign batch hands off once and accepts advance only from its own shell", async () => {
  const game = await mountGame();
  game.shell.document.body.dataset.campaignActive = "true";
  for (let index = 0; index < SOUND_QUASAR_ROUND_COUNT; index += 1) { game.click(game.element("Skip")); await game.continue(); }
  assert.equal(game.messages.filter(({ message }) => message.type === "round-complete").length, 1);
  const advance = { source: "caatuu-app-shell", type: "campaign-advance" };
  game.window.dispatchEvent({ type: "message", origin: "https://other.test", source: game.shell, data: advance });
  game.window.dispatchEvent({ type: "message", origin: "https://caatuu.test", source: {}, data: advance });
  await game.advance(10000);
  assert.equal(game.element("Transition").hidden, false);
  game.window.dispatchEvent({ type: "message", origin: "https://caatuu.test", source: game.shell, data: advance });
  assert.equal(game.element("Transition").hidden, true);
  assert.equal(game.element("Listen").disabled, true, "the next batch waits until the shell makes the game active");
  game.noCredit();
  game.controller.destroy();
});

for (const language of ["czech", "mandarin-simplified", "spanish"]) {
  test(`${language} result readings use only authored pinyin`, async () => {
    const game = await mountGame({ language });
    game.click(game.element("Sentences"));
    await game.listen();
    const item = game.current();
    game.click(game.choice(item.id));
    const expected = item.reading?.system === "pinyin"
      ? item.reading.tokens.flatMap((token) => token.units.map((unit) => unit.notation)).join(" ") : "";
    assert.equal(game.element("ResultReading").textContent, expected);
    assert.equal(game.element("ResultReading").hidden, !expected);
    assert.equal(game.element("ResultMeaning").textContent, item.meaning);
    game.controller.destroy();
  });
}

test("global mute offers recovery and cancels pending speech without allowing an answer", async () => {
  const game = await mountGame({ muted: true });
  assert.equal(game.element("Unmute"), null);
  assert.equal(game.element("Listen").disabled, false);
  assert.equal(game.element("Skip").hidden, false);
  assert.ok(game.choices().every((button) => button.disabled));
  game.shell.CaatuuChrome.setSpeechMuted(false);
  await settle();
  assert.equal(game.preferences.muted, false);
  assert.equal(game.speechCalls.length, 0, "unmuting requires a separate listen gesture");
  const playback = deferred();
  game.setSpeechResult(playback.promise);
  await game.listen();
  const stops = game.preferences.stops;
  game.shell.CaatuuChrome.setSpeechMuted(true);
  assert.ok(game.preferences.stops > stops);
  playback.resolve({ outcome: "completed" });
  await settle();
  assert.ok(game.choices().every((button) => button.disabled));
  game.noCredit();
  game.controller.destroy();
});

test("missing language voices block playback until retry finds a usable voice", async () => {
  const game = await mountGame({ voiceState: {
    available: false, backend: "browser", voices: [], reason: "no-language-voice"
  } });
  assert.equal(game.element("Listen").disabled, true);
  assert.equal(game.element("RetryAudio").hidden, false);
  assert.ok(game.element("AudioStatus").textContent.trim());
  assert.ok(game.choices().every((button) => button.disabled));
  assert.equal(game.speechCalls.length, 0);
  game.setVoiceState({ available: true, backend: "browser", voices: [
    { name: "Recovered voice", value: "browser:zh-CN", locale: "zh-CN" }
  ] });
  game.click(game.element("RetryAudio"));
  await settle();
  assert.equal(game.element("Listen").disabled, false);
  assert.equal(game.speechCalls.length, 0);
  await game.listen();
  assert.ok(game.choices().every((button) => !button.disabled));
  game.noCredit();
  game.controller.destroy();
});

for (const outcome of ["muted", "stopped", "failed", undefined]) {
  test(`${outcome} speech cannot unlock answers or earn completion`, async () => {
    const game = await mountGame({ speechResult: { outcome } });
    await game.listen();
    assert.ok(game.choices().every((button) => button.disabled));
    assert.equal(game.element("Feedback").textContent, interfaceContent.t(outcome === "muted" ? "soundquasar.muted" : "soundquasar.audio.stopped"));
    game.noCredit();
    game.controller.destroy();
  });
}

test("speech rejection blocks answers and a successful replay clears the failed state", async () => {
  const playback = deferred();
  const game = await mountGame({ speechResult: playback.promise });
  await game.listen();
  playback.reject(new Error("Fixture speech failure"));
  await settle();
  assert.ok(game.choices().every((button) => button.disabled));
  assert.equal(game.element("Listen").getAttribute("aria-pressed"), "false");
  assert.equal(game.element("Feedback").textContent, interfaceContent.t("soundquasar.audio.failed", { language: interfaceContent.languageName(game.course.targetLanguage) }));
  assert.equal(game.element("RetryAudio").hidden, false);
  game.noCredit();
  game.setSpeechResult({ outcome: "completed" });
  await game.listen();
  assert.ok(game.choices().every((button) => !button.disabled));
  assert.equal(game.element("AudioStatus").textContent, "");
  assert.equal(game.element("Feedback").textContent, "");
  assert.equal(game.element("RetryAudio").hidden, true);
  game.noCredit();
  game.controller.destroy();
});

test("changing listening content clears the previous question's playback error", async () => {
  const playback = deferred();
  const game = await mountGame({ speechResult: playback.promise });
  await game.listen();
  playback.reject(new Error("Fixture speech failure"));
  await settle();
  assert.equal(game.element("AudioStatus").textContent, "Fixture speech failure");
  game.click(game.element("Sentences"));
  assert.equal(game.element("AudioStatus").textContent, "");
  assert.equal(game.element("Feedback").textContent, "");
  assert.equal(game.element("RetryAudio").hidden, true);
  assert.ok(game.choices().every((button) => button.disabled), "a new question still requires completed playback");
  game.noCredit();
  game.controller.destroy();
});

test("only a visibility message from the same-origin shell can interrupt playback", async () => {
  const playback = deferred();
  const game = await mountGame({ speechResult: playback.promise });
  await game.listen();
  const message = { source: "caatuu-app-shell", type: "visibility", active: false };
  const stops = game.preferences.stops;
  game.window.dispatchEvent({ type: "message", origin: "https://other.test", source: game.shell, data: message });
  game.window.dispatchEvent({ type: "message", origin: "https://caatuu.test", source: {}, data: message });
  assert.equal(game.preferences.stops, stops);
  game.window.dispatchEvent({ type: "message", origin: "https://caatuu.test", source: game.shell, data: message });
  assert.ok(game.preferences.stops > stops);
  playback.resolve({ outcome: "completed" });
  await settle();
  assert.ok(game.choices().every((button) => button.disabled));
  game.noCredit();
  game.controller.destroy();
});

for (const lifecycle of ["parent visibility", "pagehide", "destroy"]) {
  test(`${lifecycle} cancels pending playback and late completion cannot enable the board`, async () => {
    const playback = deferred();
    const game = await mountGame({ speechResult: playback.promise });
    await game.listen();
    const stops = game.preferences.stops;
    if (lifecycle === "parent visibility") {
      game.parent.document.visibilityState = "hidden";
      game.parent.document.dispatchEvent({ type: "visibilitychange" });
    } else if (lifecycle === "pagehide") {
      game.window.dispatchEvent({ type: "pagehide", persisted: false });
    } else game.controller.destroy();
    assert.ok(game.preferences.stops > stops);
    playback.resolve({ outcome: "completed" });
    await settle();
    assert.ok(game.choices().every((button) => button.disabled));
    game.noCredit();
    game.controller.destroy();
    assert.equal(game.element("Controls").children.length, 0, "destroy removes shared toolbar controls");
  });
}

test("a browser speech API without a matching language voice is not ready even when available is true", async () => {
  const game = await mountGame({ voiceState: {
    available: true, backend: "browser", voices: [], reason: "no-language-voice"
  } });
  assert.equal(game.element("Listen").disabled, true);
  assert.equal(game.element("RetryAudio").hidden, false);
  assert.equal(game.element("AudioStatus").textContent, interfaceContent.t("soundquasar.audio.unavailable", {
    language: interfaceContent.languageName(game.course.targetLanguage)
  }));
  assert.equal(game.speechCalls.length, 0);
  game.noCredit();
  game.controller.destroy();
});

test("an available native voice uses the shared speech completion contract", async () => {
  const game = await mountGame({ voiceState: { available: true, backend: "android", voices: [] } });
  await game.listen();
  assert.ok(game.current());
  assert.ok(game.choices().every((button) => !button.disabled));
  game.click(game.choice(game.current().id));
  assert.equal(game.element("Result").hidden, false);
  assert.deepEqual(game.records, [["sound-quasar", { activities: 1, attempts: 1, successes: 1, xp: 1 }]]);
  game.noCampaign();
  game.controller.destroy();
});

test("destroy invalidates pending voice discovery as well as playback", async () => {
  const discovery = deferred();
  const game = await mountGame({ voiceState: discovery.promise });
  assert.equal(game.element("Listen").disabled, true);
  game.controller.destroy();
  discovery.resolve({ available: true, backend: "android", voices: [] });
  await settle();
  assert.equal(game.element("Listen").disabled, true);
  assert.ok(game.choices().every((button) => button.disabled));
  assert.equal(game.element("Controls").children.length, 0);
  game.noCredit();
});

test("content loading uses the shared robot and ends without an extra readiness delay", async () => {
  const game = await mountGame({ beforeContent: async ({ harness, clock, speechCalls }) => {
    const loading = harness.document.getElementById("quasarLoading");
    assert.equal(loading.hidden, false);
    assert.equal(loading.classList.contains("caatuu-game-robot-loading"), true);
    assert.equal(loading.getAttribute("role"), "status");
    assert.equal(loading.getAttribute("aria-label"), interfaceContent.t("verbnebula.round.preparing"));
    assert.equal(loading.querySelector("img").classList.contains("caatuu-game-robot-loading-art"), true);
    assert.equal(loading.textContent.trim(), "");
    assert.equal(harness.document.getElementById("quasarGame").hidden, true);
    assert.equal(harness.document.getElementById("quasarRoot").getAttribute("aria-busy"), "true");
    assert.equal(clock.pending().length, 0);
    await clock.advance(10000);
    assert.equal(loading.hidden, false);
    assert.equal(speechCalls.length, 0);
  } });
  assert.equal(game.element("Loading").hidden, true);
  assert.equal(game.element("Game").hidden, false);
  assert.equal(game.element("Root").getAttribute("aria-busy"), "false");
  assert.equal(game.clock.pending().length, 0);
  game.controller.destroy();
});

test("shell visibility pauses the initial robot and defers autoplay until the game returns", async () => {
  const game = await mountGame({ muted: false, beforeContent: ({ harness, shell }) => {
    const loading = harness.document.getElementById("quasarLoading");
    const visibility = (origin) => harness.window.dispatchEvent({ type: "message", origin, source: shell,
      data: { source: "caatuu-app-shell", type: "visibility", active: false } });
    visibility("https://other.test");
    assert.equal(loading.dataset.active, "true");
    visibility("https://caatuu.test");
    assert.equal(loading.dataset.active, "false");
  } });
  assert.equal(game.speechCalls.length, 0);
  assert.ok(game.choices().every((button) => button.disabled));
  game.window.dispatchEvent({ type: "message", origin: "https://caatuu.test", source: game.shell,
    data: { source: "caatuu-app-shell", type: "visibility", active: true } });
  await settle();
  assert.equal(game.speechCalls.length, 1);
  game.controller.destroy();
});

test("retiring a frame during content loading prevents a late board or audio from mounting", async () => {
  const game = await mountGame({ muted: false, beforeContent: ({ harness }) => {
    harness.window.dispatchEvent({ type: "pagehide", persisted: false });
    assert.equal(harness.document.getElementById("quasarLoading").hidden, true);
  } });
  assert.equal(game.controller, null);
  assert.equal(game.element("Loading").hidden, true);
  assert.equal(game.element("Game").hidden, true);
  assert.equal(game.element("Controls").children.length, 0);
  assert.equal(game.choices().length, 0);
  assert.equal(game.speechCalls.length, 0);
  game.noCredit();
});

test("a failed declared content request retires the loader and controls instead of mounting a playable board", async () => {
  let document;
  await assert.rejects(mountGame({ fetchFailure: true, beforeContent: ({ harness }) => { document = harness.document; } }), /503/u);
  assert.equal(document.getElementById("quasarLoading").hidden, true);
  assert.equal(document.getElementById("quasarGame").hidden, true);
  assert.equal(document.getElementById("quasarControls").children.length, 0);
});

test("free game space replays audio once; answers, controls, and the information box do not", async () => {
  const game = await mountGame();
  assert.equal(game.element("Feedback").textContent, "");
  assert.equal(game.element("Listen").textContent.trim(), "");
  assert.ok(game.element("Listen").contains(game.element("Emblem")));
  assert.ok(!game.element("Listen").contains(game.element("Skip")));
  assert.ok(!game.element("Listen").contains(game.element("RetryAudio")));
  for (const target of [game.element("Panel"), game.element("Progress"), game.element("Sound"), game.element("Emblem"), game.element("Choices")]) {
    const count = game.speechCalls.length;
    target.click();
    await settle();
    assert.equal(game.speechCalls.length, count + 1);
    assert.ok(game.choices().every((button) => !button.disabled));
    assert.equal(game.element("Feedback").textContent, "");
  }
  const count = game.speechCalls.length;
  game.document.querySelector(".quasar-info").click();
  game.element("Controls").querySelector('[aria-label="Audio settings"]').click();
  game.element("Controls").querySelector(".caatuu-game-controls-popover").click();
  game.element("Report").click();
  game.element("ReportComment").click();
  game.element("ReportCancel").click();
  game.click(game.choice(game.current().id));
  await settle();
  assert.equal(game.speechCalls.length, count);
  assert.equal(game.reports.length, 0, "opening and cancelling never saves a report");
  await game.continue();
  await game.listen();
  assert.equal(game.speechCalls.length, count + 1, "the accessible speaker button must not bubble into a second play");
  game.controller.destroy();
});

test("non-primary clicks, selected text, and an inactive game cannot trigger free-space playback", async () => {
  const game = await mountGame();
  game.element("Panel").dispatchEvent({ type: "click", bubbles: true, button: 2 });
  game.window.getSelection = () => ({ isCollapsed: false });
  game.element("Panel").click();
  delete game.window.getSelection;
  await settle();
  assert.equal(game.speechCalls.length, 0);
  game.window.dispatchEvent({ type: "message", origin: "https://caatuu.test", source: game.shell,
    data: { source: "caatuu-app-shell", type: "visibility", active: false } });
  game.element("Panel").click();
  await settle();
  assert.equal(game.speechCalls.length, 0);
  game.controller.destroy();
});

test("reports save the heard word and speech settings once with a bounded note", async () => {
  const pending = deferred();
  const game = await mountGame({ reportResult: pending.promise });
  game.preferences.voice = "browser:test-voice";
  await game.listen();
  const item = game.current();
  game.preferences.voice = "another-voice";
  game.click(game.element("Report"));
  assert.equal(game.element("ReportDialog").open, true);
  game.element("ReportReason").value = "wrong-word";
  game.element("ReportComment").value = "x".repeat(500);
  game.element("ReportForm").dispatchEvent({ type: "submit" });
  game.element("ReportForm").dispatchEvent({ type: "submit" });
  await settle();
  assert.equal(game.reports.length, 1);
  const { payload, options } = game.reports[0];
  assert.equal(payload.feedback.itemId, item.id);
  assert.equal(payload.feedback.target, item.target);
  assert.equal(payload.feedback.courseId, game.course.id);
  assert.equal(payload.feedback.contentRevision, game.catalog.contentRevision);
  assert.equal(payload.feedback.audio.locale, game.catalog.audio.locale);
  assert.equal(payload.feedback.audio.voice, "browser:test-voice");
  assert.equal(payload.feedback.reason, "wrong-word");
  assert.equal(payload.feedback.comment.length, 400);
  assert.equal(options.id, payload.feedback.clientReportId);
  assert.equal(game.element("ReportSubmit").disabled, true);
  pending.resolve({ queued: true, persisted: true });
  await settle();
  assert.equal(game.element("ReportDialog").open, false);
  assert.equal(game.element("Report").disabled, true);
  assert.equal(game.element("ReportStatus").textContent, interfaceContent.t("wordworld.report.savedlocal"));
  assert.equal(game.speechCalls.length, 1);
  game.noCredit();
  game.controller.destroy();
});

test("failed report storage preserves the form for retry and reuses its report identity", async () => {
  const game = await mountGame({ reportResult: () => { throw new Error("Storage unavailable"); } });
  game.click(game.element("Report"));
  game.element("ReportReason").value = "no-sound";
  game.element("ReportComment").value = "Nothing played";
  game.element("ReportForm").dispatchEvent({ type: "submit" });
  await settle();
  assert.equal(game.element("ReportDialog").open, true);
  assert.equal(game.element("ReportSubmit").disabled, false);
  assert.equal(game.element("ReportComment").value, "Nothing played");
  assert.equal(game.element("ReportDialogStatus").textContent, interfaceContent.t("wordworld.report.savefailed"));
  game.setReportResult({ queued: true, persisted: false });
  game.element("ReportForm").dispatchEvent({ type: "submit" });
  await settle();
  assert.equal(game.reports[0].options.id, game.reports[1].options.id);
  assert.equal(game.element("ReportStatus").textContent, interfaceContent.t("wordworld.report.sessiononly"));
  game.controller.destroy();
});

test("a pending report saved after the dialog closes still updates the current report button", async () => {
  const pending = deferred();
  const game = await mountGame({ reportResult: pending.promise });
  game.click(game.element("Report"));
  game.element("ReportForm").dispatchEvent({ type: "submit" });
  game.click(game.element("ReportCancel"));
  pending.resolve({ queued: true, persisted: true });
  await settle();
  assert.equal(game.element("ReportDialog").open, false);
  assert.equal(game.element("Report").disabled, true);
  assert.equal(game.element("Report").textContent, interfaceContent.t("wordworld.report.savedaction"));
  game.element("Report").dispatchEvent({ type: "click" });
  assert.equal(game.element("ReportDialog").open, false);
  assert.equal(game.reports.length, 1);
  game.noCredit();
  game.controller.destroy();
});

test("a late report save cannot replace the status of a different word", async () => {
  const pending = deferred();
  const game = await mountGame({ reportResult: pending.promise });
  game.click(game.element("Report"));
  game.element("ReportForm").dispatchEvent({ type: "submit" });
  game.click(game.element("ReportCancel"));
  game.click(game.element("Skip")); await game.continue();
  pending.resolve({ queued: true, persisted: true });
  await settle();
  assert.equal(game.element("ReportStatus").textContent, "");
  assert.equal(game.element("Report").disabled, false);
  assert.equal(game.element("Report").textContent, interfaceContent.t("soundquasar.report.action"));
  assert.equal(game.reports.length, 1);
  game.controller.destroy();
});

test("reporting remains available without a voice and closes when the game leaves view", async () => {
  const game = await mountGame({ voiceState: { available: false, voices: [] } });
  game.click(game.element("Report"));
  game.element("Panel").click();
  assert.equal(game.speechCalls.length, 0);
  game.window.dispatchEvent({ type: "message", origin: "https://caatuu.test", source: game.shell,
    data: { source: "caatuu-app-shell", type: "visibility", active: false } });
  assert.equal(game.element("ReportDialog").open, false);
  game.element("ReportForm").dispatchEvent({ type: "submit" });
  await settle();
  assert.equal(game.reports.length, 0);
  game.controller.destroy();
});

test("replaying and skipping cannot award XP, and duplicate answers cannot award twice", async () => {
  const game = await mountGame();
  await game.listen();
  await game.listen();
  const skippedChoice = game.choice(game.current().id);
  game.click(game.element("Skip")); await game.continue();
  skippedChoice.dispatchEvent({ type: "click" });
  game.noCredit();
  await game.listen();
  const correct = game.choice(game.current().id);
  game.click(correct);
  correct.click();
  correct.dispatchEvent({ type: "click" });
  game.element("Skip").dispatchEvent({ type: "click" });
  await game.listen();
  assert.deepEqual(game.records, [["sound-quasar", { activities: 1, attempts: 1, successes: 1, xp: 1 }]]);
  game.noCampaign();
  game.controller.destroy();
});

test("learning change callbacks cannot reenter the same answer or completed round", async () => {
  let attemptedChoice;
  const game = await mountGame({ onRecord: ({ args, clock }) => {
    if (args[1].attempts) attemptedChoice?.dispatchEvent({ type: "click" });
    if (args[1].rounds) game.element("Continue").click();
  } });
  for (let index = 0; index < SOUND_QUASAR_ROUND_COUNT; index += 1) {
    await game.listen();
    if (index === 0) {
      attemptedChoice = game.choices().find((button) => button.dataset.choiceId !== game.current().id);
      game.click(attemptedChoice);
    }
    attemptedChoice = game.choice(game.current().id);
    game.click(attemptedChoice);
    await game.continue();
  }
  assert.equal(game.records.length, SOUND_QUASAR_ROUND_COUNT + 2, "one wrong attempt, three successful attempts, and one finished session");
  assert.equal(game.records.reduce((sum, [, delta]) => sum + (delta.xp || 0), 0), SOUND_QUASAR_ROUND_COUNT);
  assert.equal(game.records.filter(([, delta]) => delta.rounds).length, 1);
  game.noCampaign();
  game.controller.destroy();
});

for (const language of ["czech", "mandarin-simplified", "spanish"]) {
  test(`${language} switches through Aa to sentence listening and awards one session`, async () => {
    const game = await mountGame({ language });
    const modeToggle = game.element("Controls").querySelector('[aria-label="Listening content"]');
    assert.ok(modeToggle, "the shared Aa toolbar exposes content selection");
    game.click(modeToggle);
    const speechBeforeMode = game.speechCalls.length;
    game.click(game.element("Sentences"));
    assert.equal(game.element("Game").dataset.mode, "sentences");
    assert.equal(game.element("Sentences").getAttribute("aria-pressed"), "true");
    assert.equal(game.element("Words").getAttribute("aria-pressed"), "false");
    assert.equal(game.speechCalls.length, speechBeforeMode, "changing modes does not autoplay");
    assert.ok(game.choices().every((button) => button.disabled));
    const sentenceIds = new Set(game.catalog.sentences.map(({ id }) => id));
    const heard = new Set();
    const artwork = new Set();
    for (let index = 0; index < SOUND_QUASAR_ROUND_COUNT; index += 1) {
      assert.equal(game.element("Progress").textContent, interfaceContent.t("soundquasar.progress.sentences", { number: index + 1, count: SOUND_QUASAR_ROUND_COUNT }));
      assert.match(game.element("Emblem").src, /^\/assets\/macaw\/music\/music%20\(\d+\)\.png$/u);
      artwork.add(game.element("Emblem").src);
      await game.listen();
      const item = game.current();
      assert.ok(sentenceIds.has(item.id), "the spoken answer belongs to the sentence catalog");
      assert.equal(heard.has(item.id), false, "one sentence session does not repeat its answer");
      heard.add(item.id);
      assert.ok(game.choices().every((button) => sentenceIds.has(button.dataset.choiceId)), "sentence answers never mix with word distractors");
      if (language === "mandarin-simplified") {
        for (const button of game.choices()) {
          assert.ok(button.querySelectorAll(".caatuu-target-tone").length > 0, "Mandarin sentences also render their authored tones");
          assert.equal(button.querySelector(".quasar-choice-target").textContent, game.catalog.sentences.find(({ id }) => id === button.dataset.choiceId).target, "tone styling preserves characters and punctuation without displaying extra pinyin");
        }
      }
      game.click(game.choice(item.id));
      await game.continue();
    }
    assert.ok(artwork.size > 1, "successive questions choose different music artwork");
    assert.equal(game.element("Transition").hidden, true);
    assert.equal(game.records.reduce((sum, [, delta]) => sum + (delta.xp || 0), 0), SOUND_QUASAR_ROUND_COUNT);
    assert.deepEqual(game.records.filter(([, delta]) => delta.rounds), [["sound-quasar", { rounds: 1, streakEligible: true }]]);
    game.noCampaign();
    game.controller.destroy();
  });
}

test("switching modes cancels old audio and requires hearing the new question before it can earn XP", async () => {
  const playback = deferred();
  const game = await mountGame({ speechResult: playback.promise });
  const oldChoices = game.choices();
  await game.listen();
  const stops = game.preferences.stops;
  game.click(game.element("Sentences"));
  assert.ok(game.preferences.stops > stops);
  playback.resolve({ outcome: "completed" });
  await settle();
  assert.ok(game.choices().every((button) => button.disabled));
  for (const button of oldChoices) button.dispatchEvent({ type: "click" });
  game.noCredit();
  game.setSpeechResult({ outcome: "completed" });
  await game.listen();
  game.click(game.choice(game.current().id));
  assert.equal(game.records.reduce((sum, [, delta]) => sum + (delta.xp || 0), 0), 1);
  game.click(game.element("Words"));
  assert.equal(game.element("Game").dataset.mode, "words");
  assert.equal(game.element("Progress").textContent, interfaceContent.t("soundquasar.progress", { number: 1, count: SOUND_QUASAR_ROUND_COUNT }));
  assert.ok(game.choices().every((button) => button.disabled));
  assert.equal(game.records.filter(([, delta]) => delta.rounds).length, 0, "changing an unfinished session does not count a round");
  game.noCampaign();
  game.controller.destroy();
});

test("skipping an entire session gives no XP, coin, or streak qualification", async () => {
  const game = await mountGame({ realLearning: true });
  for (let index = 0; index < SOUND_QUASAR_ROUND_COUNT; index += 1) { game.click(game.element("Skip")); await game.continue(); }
  assert.equal(game.element("Transition").hidden, true);
  game.noCredit();
  assert.equal(game.shell.CaatuuLearning.snapshot().summary.xp, 0);
  assert.equal(game.shell.CaatuuLearning.snapshot().summary.rounds, 0);
  assert.equal(game.shell.CaatuuLearning.snapshot().streak.currentDays, 0);
  game.controller.destroy();
});

test("earned Quasar XP and rounds persist through the shared learning profile and journey totals", async () => {
  const game = await mountGame({ realLearning: true });
  for (let index = 0; index < SOUND_QUASAR_ROUND_COUNT; index += 1) {
    await game.listen();
    game.click(game.choice(game.current().id));
    await game.continue();
  }
  const profile = game.shell.CaatuuLearning.snapshot();
  assert.equal(profile.performance.games["sound-quasar"].xp, SOUND_QUASAR_ROUND_COUNT);
  assert.equal(profile.summary.rounds, 1);
  assert.equal(profile.journey.summary.xp, SOUND_QUASAR_ROUND_COUNT);
  assert.equal(profile.journey.summary.rounds, 1);
  assert.equal(profile.streak.currentDays, 1);
  // Reload all durable storage: progress may be in a compact checkpoint or
  // pending journal entries when the simulated browser has no lock provider.
  const stored = game.parent.localStorage.snapshot();
  const reloaded = createBrowserHarness({ course: game.course, localStorageValues: stored });
  vm.runInContext(learningProfileSource, reloaded.context, { filename: "learning-profile.js" });
  assert.equal(reloaded.window.CaatuuLearning.snapshot().journey.summary.xp, SOUND_QUASAR_ROUND_COUNT);
  assert.equal(reloaded.window.CaatuuLearning.snapshot().journey.summary.rounds, 1);
  game.noCampaign();
  game.controller.destroy();
});

test("skip reveals its correction and waits for Continue without earning credit", async () => {
  const game = await mountGame();
  assert.equal(game.element("Reveal"), null);
  assert.equal(game.element("Next"), null);
  const choices = game.choices();
  game.click(game.element("Skip"));
  assert.equal(game.element("Progress").textContent, "Word 1 of 3");
  assert.equal(game.element("Result").hidden, false);
  assert.ok(game.element("ResultTarget").textContent);
  await game.advance(86400000);
  assert.equal(game.element("Progress").textContent, "Word 1 of 3");
  await game.continue();
  assert.equal(game.element("Progress").textContent, "Word 2 of 3");
  assert.equal(game.element("Result").hidden, true);
  assert.equal(game.element("AnswerArea").classList.contains("is-result"), false);
  assert.ok(choices.every((button) => !button.isConnected));
  assert.ok(game.choices().every((button) => button.disabled));
  assert.equal(game.speechCalls.length, 0);
  game.noCredit();
  game.controller.destroy();
});

for (const { mode, meaning, delay } of [
  { mode: "words", meaning: "short meaning", delay: 3000 },
  { mode: "sentences", meaning: "A short sentence.", delay: 4500 },
  { mode: "words", meaning: "a".repeat(80), delay: 5400 },
  { mode: "sentences", meaning: "a".repeat(160), delay: 8000 }
]) {
  test(`${mode} corrections with ${meaning.length} translation characters wait indefinitely for Continue`, async () => {
    const game = await mountGame({ mutateCatalog: (catalog) => {
      for (const item of [...catalog.items, ...catalog.sentences]) item.meaning = meaning;
    } });
    if (mode === "sentences") game.click(game.element("Sentences"));
    await game.listen();
    const wrongChoices = game.choices().filter(button => button.dataset.choiceId !== game.current().id);
    game.click(wrongChoices[0]);
    game.click(wrongChoices[1]);
    assert.equal(game.clock.pending().length, 0);
    const firstProgress = game.element("Progress").textContent;
    await game.advance(delay - 1);
    assert.equal(game.element("Progress").textContent, firstProgress);
    assert.equal(game.element("Result").hidden, false);
    await game.advance(86400000);
    assert.equal(game.element("Progress").textContent, firstProgress);
    await game.continue();
    assert.notEqual(game.element("Progress").textContent, firstProgress);
    assert.equal(game.element("Result").hidden, true);
    game.controller.destroy();
  });
}

for (const pauseReason of ["report", "controls", "hidden document", "inactive panel", "persisted pagehide"]) {
  test(`${pauseReason} keeps result review pending until an eligible Continue`, async () => {
    const game = await mountGame();
    await game.listen();
    game.click(game.choice(game.current().id));
    const progress = game.element("Progress").textContent;
    await game.advance(1000);
    const audioSettings = game.element("Controls").querySelector('[aria-label="Audio settings"]');
    const visibility = (active) => game.window.dispatchEvent({ type: "message", origin: "https://caatuu.test", source: game.shell,
      data: { source: "caatuu-app-shell", type: "visibility", active } });
    if (pauseReason === "report") game.click(game.element("Report"));
    else if (pauseReason === "controls") game.click(audioSettings);
    else if (pauseReason === "hidden document") {
      game.parent.document.visibilityState = "hidden";
      game.parent.document.dispatchEvent({ type: "visibilitychange" });
    } else if (pauseReason === "inactive panel") visibility(false);
    else game.window.dispatchEvent({ type: "pagehide", persisted: true });
    assert.equal(game.clock.pending().length, 0);
    game.element("Continue").dispatchEvent({ type: "click", bubbles: false });
    await game.advance(10000);
    assert.equal(game.element("Progress").textContent, progress, "an obsolete queued callback cannot advance the paused result");
    assert.equal(game.element("Result").hidden, false);
    if (pauseReason === "report") game.click(game.element("ReportCancel"));
    else if (pauseReason === "controls") game.click(audioSettings);
    else if (pauseReason === "hidden document") {
      game.parent.document.visibilityState = "visible";
      game.parent.document.dispatchEvent({ type: "visibilitychange" });
    } else if (pauseReason === "inactive panel") visibility(true);
    else game.window.dispatchEvent({ type: "pageshow", persisted: true });
    await settle();
    assert.equal(game.clock.pending().length, 0);
    await game.advance(86400000);
    assert.equal(game.element("Progress").textContent, progress);
    await game.continue();
    assert.notEqual(game.element("Progress").textContent, progress);
    assert.equal(game.records.length, 1, "pausing does not duplicate the successful answer's XP");
    game.controller.destroy();
  });
}

test("replaying a result and finishing audio still require Continue", async () => {
  const game = await mountGame();
  await game.listen();
  game.click(game.choice(game.current().id));
  const progress = game.element("Progress").textContent;
  await game.advance(1000);
  const playback = deferred();
  game.setSpeechResult(playback.promise);
  await game.listen();
  assert.equal(game.clock.pending().length, 0);
  await game.advance(10000);
  assert.equal(game.element("Progress").textContent, progress);
  playback.resolve({ outcome: "completed" });
  await settle();
  assert.equal(game.clock.pending().length, 0);
  await game.advance(86400000);
  assert.equal(game.element("Progress").textContent, progress);
  await game.continue();
  assert.notEqual(game.element("Progress").textContent, progress);
  assert.equal(game.records.length, 1);
  game.controller.destroy();
});

test("explicit Continue interrupts replay once and fences its late completion", async () => {
  const game = await mountGame();
  await game.listen();
  game.click(game.choice(game.current().id));
  const playback = deferred();
  game.setSpeechResult(playback.promise);
  await game.listen();
  const progress = game.element("Progress").textContent;
  const stops = game.preferences.stops;
  const continuation = game.element("Continue");
  assert.equal(continuation.disabled, false);
  await game.continue(); continuation.click();
  const nextProgress = game.element("Progress").textContent;
  assert.notEqual(nextProgress, progress);
  assert.ok(game.preferences.stops > stops);
  playback.resolve({ outcome: "completed" }); await settle();
  await game.advance(86400000);
  assert.equal(game.element("Progress").textContent, nextProgress);
  assert.ok(game.choices().every(choice => choice.disabled));
  assert.equal(game.records.length, 1);
  assert.equal(game.element("Continue").hidden, true);
  game.controller.destroy();
});

for (const language of ["czech", "mandarin-simplified", "spanish"]) {
  test(`${language} level zero keeps selectable listening alternatives and solves a complete session`, async () => {
    const game = await mountGame({ language, realLearning: true, difficulty: 0 });
    assert.equal(game.shell.CaatuuLearning.difficulty(), 0);
    assert.equal(game.choices().length, 4, "zero keeps the normal default");
    const toggle = game.element("Controls").querySelector('[aria-label="Answer options"]');
    for (const mode of ["Words", "Sentences"]) {
      game.click(game.element(mode));
      for (const count of [6, 4]) {
        game.click(toggle);
        const option = game.element(count === 6 ? "SixChoices" : "FourChoices");
        assert.equal(option.disabled, false, "zero keeps both normal answer settings");
        game.click(option);
        for (let round = 0; round < SOUND_QUASAR_ROUND_COUNT; round++) {
          assert.equal(game.choices().length, count);
          await game.listen();
          const item = (mode === "Words" ? game.catalog.items : game.catalog.sentences).find(candidate =>
            candidate.difficulty === 0 && candidate.target === game.speechCalls.at(-1)?.text);
          assert.ok(item, "the spoken prompt belongs to the zero bank");
          assert.equal(item.difficulty, 0, "simple content stays in its own band");
          game.click(game.choice(item.id));
          assert.equal(game.element("Result").hidden, false);
          await game.continue();
        }
      }
    }
    assert.equal(game.records.filter(([, delta]) => delta.attempts).length, 4 * SOUND_QUASAR_ROUND_COUNT);
    game.controller.destroy();
  });

  test(`${language} offers four or six distinct answers for words and sentences`, async () => {
    const game = await mountGame({ language });
    const toggle = game.element("Controls").querySelector('[aria-label="Answer options"]');
    assert.ok(toggle.querySelectorAll("rect").length > 0, "use the shared boxes icon");
    for (const mode of ["Words", "Sentences"]) {
      game.click(game.element(mode));
      for (const count of [6, 4]) {
        game.click(toggle);
        const option = game.element(count === 6 ? "SixChoices" : "FourChoices");
        game.click(option);
        assert.equal(option.getAttribute("aria-pressed"), "true");
        assert.equal(toggle.getAttribute("aria-expanded"), "false");
        assert.equal(game.choices().length, count);
        assert.equal(new Set(game.choices().map((choice) => choice.dataset.choiceId)).size, count);
        assert.ok(game.choices().every((choice) => choice.disabled));
        await game.listen();
        assert.ok(game.choice(game.current().id), "every board includes the spoken answer");
        assert.equal(game.parent.localStorage.getItem(`${game.course.storage.namespace}.soundQuasar.choiceCount.v1`), String(count));
      }
    }
    game.noCredit();
    game.controller.destroy();
  });
}

test("listening mode survives closing and reopening, independently for each course", async () => {
  const first = await mountGame({ realLearning: true, modeOverride: null });
  first.click(first.element("Sentences"));
  first.click(first.element("SixChoices"));
  const stored = first.parent.localStorage.snapshot();
  first.controller.destroy();
  const reopened = await mountGame({ realLearning: true, modeOverride: null, localStorageValues: stored });
  assert.equal(reopened.element("Game").dataset.mode, "sentences");
  assert.equal(reopened.element("Sentences").getAttribute("aria-pressed"), "true");
  assert.equal(reopened.choices().length, 6);
  await reopened.listen();
  assert.ok(reopened.catalog.sentences.some(item => item.id === reopened.current().id));
  reopened.click(reopened.element("Words"));
  const words = reopened.parent.localStorage.snapshot();
  reopened.controller.destroy();
  for (const options of [{ localStorageValues: words, expected: "words" },
    { language: "czech", localStorageValues: stored, expected: "sentences" }]) {
    const game = await mountGame({ ...options, realLearning: true, modeOverride: null });
    // A different course has its own difficulty and defaults.
    assert.equal(game.element("Game").dataset.mode, options.expected);
    game.noCredit();
    game.controller.destroy();
  }
});

test("invalid or inaccessible listening preferences keep a playable session", async () => {
  const game = await mountGame({ realLearning: true, modeOverride: null,
    localStorageValues: { "caatuu-zh.soundQuasar.mode.v1": "invalid" } });
  assert.equal(game.element("Game").dataset.mode, "sentences");
  game.shell.localStorage.setItem = () => { throw new Error("Storage unavailable"); };
  game.click(game.element("Words"));
  assert.equal(game.element("Game").dataset.mode, "words");
  game.noCredit();
  game.controller.destroy();
});

test("six-answer preference survives remounting and safely falls back for smaller catalogs", async () => {
  const game = await mountGame({ realLearning: true });
  game.click(game.element("SixChoices"));
  assert.equal(game.choices().length, 6);
  const stored = game.parent.localStorage.snapshot();
  game.controller.destroy();
  const small = await mountGame({ realLearning: true, modeOverride: null, localStorageValues: stored, mutateCatalog(catalog) {
    catalog.sentences = catalog.sentences.slice(0, 4).map(row => ({ ...row, difficulty: 1 }));
    catalog.sentenceProvenance.sourceItemIds = catalog.sentences.map((sentence) => sentence.sourceId);
  } });
  small.click(small.element("Sentences"));
  assert.equal(small.choices().length, 4);
  assert.equal(small.element("SixChoices").disabled, true);
  small.click(small.element("Words"));
  assert.equal(small.choices().length, 6);
  small.noCredit();
  small.controller.destroy();
});

for (const difficulty of [0, 1, 2, 3]) {
  for (const settingsApi of [true, false]) {
    test(`level ${difficulty} starts with its listening defaults ${settingsApi ? "from learning preferences" : "without the settings API"}`, async () => {
      const game = await mountGame({ realLearning: settingsApi, settingsApi, difficulty, modeOverride: null,
        localStorageValues: { "caatuu-zh.soundQuasar.choiceCount.v1": "6", "caatuu-zh.soundQuasar.mode.v1": "words" } });
      const mode = difficulty === 0 ? "words" : "sentences";
      const count = [4, 4, 6, 6][difficulty];
      assert.equal(game.element("Game").dataset.mode, mode);
      assert.equal(game.choices().length, count);
      assert.equal(game.element(mode === "words" ? "Words" : "Sentences").getAttribute("aria-pressed"), "true");
      assert.equal(game.element(count === 4 ? "FourChoices" : "SixChoices").getAttribute("aria-pressed"), "true");
      assert.equal(game.element("Words").disabled, false);
      assert.equal(game.element("Sentences").disabled, false);
      assert.equal(game.element("FourChoices").disabled, false);
      assert.equal(game.element("SixChoices").disabled, false);
      game.noCredit();
      game.controller.destroy();
    });
  }
}

test("manual listening settings survive rounds, sessions, same-level selection and reload, then reset with difficulty", async () => {
  const game = await mountGame({ realLearning: true, difficulty: 0, modeOverride: null });
  game.click(game.element("Sentences"));
  game.click(game.element("SixChoices"));
  for (let round = 0; round < SOUND_QUASAR_ROUND_COUNT; round += 1) {
    await game.listen();
    game.click(game.choice(game.current().id));
    await game.continue();
    assert.equal(game.element("Game").dataset.mode, "sentences");
    assert.equal(game.choices().length, 6);
  }
  game.shell.CaatuuLearning.setDifficulty(0);
  assert.equal(game.element("Game").dataset.mode, "sentences");
  assert.equal(game.choices().length, 6);
  const stored = game.parent.localStorage.snapshot();
  game.controller.destroy();
  const reopened = await mountGame({ realLearning: true, modeOverride: null, localStorageValues: stored });
  assert.equal(reopened.shell.CaatuuLearning.difficulty(), 0);
  assert.equal(reopened.element("Game").dataset.mode, "sentences");
  assert.equal(reopened.choices().length, 6);
  for (const difficulty of [1, 2, 3, 0]) {
    reopened.shell.CaatuuLearning.setDifficulty(difficulty);
    assert.equal(reopened.element("Game").dataset.mode, difficulty === 0 ? "words" : "sentences");
    assert.equal(reopened.choices().length, [4, 4, 6, 6][difficulty]);
    reopened.click(reopened.element(difficulty === 0 ? "Sentences" : "Words"));
    reopened.click(reopened.element(difficulty < 2 ? "SixChoices" : "FourChoices"));
  }
  reopened.controller.destroy();
});

test("a difficulty change while the listening catalog loads uses the new defaults", async () => {
  const game = await mountGame({ realLearning: true, difficulty: 0, modeOverride: null,
    beforeContent({ shell }) { shell.CaatuuLearning.setDifficulty(2); } });
  assert.equal(game.element("Game").dataset.mode, "sentences");
  assert.equal(game.choices().length, 6);
  game.noCredit();
  game.controller.destroy();
});

test("changing answer count cancels result advancement without granting a completed round", async () => {
  const game = await mountGame();
  await game.listen();
  game.click(game.choice(game.current().id));
  const previousContinue = game.element("Continue");
  game.click(game.element("SixChoices"));
  previousContinue.click();
  await game.advance(10000);
  assert.equal(game.element("Result").hidden, true);
  assert.equal(game.choices().length, 6);
  assert.ok(game.choices().every((choice) => choice.disabled));
  assert.equal(game.records.filter(([, delta]) => delta.rounds).length, 0);
  assert.equal(game.records.reduce((sum, [, delta]) => sum + (delta.xp || 0), 0), 1);
  game.controller.destroy();
});

for (const mode of ["Words", "Sentences"]) for (const count of [4, 6]) {
  test(`${mode} maps all ${count} numbered shortcuts to the displayed options`, async () => {
    for (let index = 0; index < count; index += 1) {
      const game = await mountGame();
      game.click(game.element(mode));
      game.click(game.element(count === 6 ? "SixChoices" : "FourChoices"));
      assert.equal(game.element("Choices").dataset.count, String(count));
      game.choices().forEach((choice, index) => {
        assert.equal(choice.querySelector(".quasar-choice-number").textContent, `${index + 1}.`);
        assert.equal(choice.getAttribute("aria-keyshortcuts"), String(index + 1));
      });
      game.document.dispatchEvent({ type: "keydown", key: "1" });
      game.noCredit();
      await game.listen();
      const correctIndex = game.choices().findIndex((choice) => choice.dataset.choiceId === game.current().id);
      const correct = index === correctIndex;
      game.document.dispatchEvent({ type: "keydown", key: String(index + 1) });
      assert.equal(game.choices()[index].classList.contains(correct ? "is-correct" : "is-wrong"), true);
      assert.equal(game.element("Result").hidden, !correct);
      assert.equal(game.records.length, 1);
      assert.equal(game.records[0][1].xp, correct ? 1 : 0);
      game.document.dispatchEvent({ type: "keydown", key: String(index + 1) });
      assert.equal(game.records.length, 1, "a submitted answer cannot be repeated");
      game.controller.destroy();
    }
  });
}

test("number shortcuts ignore modifiers, held keys, typing, menus, and inactive games", async () => {
  const game = await mountGame();
  await game.listen();
  const key = String(game.choices().findIndex((choice) => choice.dataset.choiceId === game.current().id) + 1);
  const press = (extra = {}) => game.document.dispatchEvent({ type: "keydown", key, ...extra });
  for (const flag of ["repeat", "isComposing", "ctrlKey", "altKey", "metaKey", "shiftKey", "defaultPrevented"]) press({ [flag]: true });
  press({ key: "5" });
  press({ key: "6" });
  press({ target: game.element("ReportComment") });
  const editable = game.document.createElement("div");
  editable.setAttribute("contenteditable", "true");
  game.document.body.append(editable);
  press({ target: editable });
  game.click(game.element("Controls").querySelector('[aria-label="Answer options"]'));
  press();
  game.click(game.element("Controls").querySelector('[aria-label="Answer options"]'));
  game.click(game.element("Report"));
  press();
  game.click(game.element("ReportCancel"));
  game.shell.document.visibilityState = "hidden";
  press();
  game.shell.document.visibilityState = "visible";
  game.window.dispatchEvent({ type: "message", origin: "https://caatuu.test", source: game.shell,
    data: { source: "caatuu-app-shell", type: "visibility", active: false } });
  press();
  game.noCredit();
  game.controller.destroy();
  press();
  game.noCredit();
});

test("macaw mirroring is sampled per prompt and stays stable during playback", async () => {
  let sample = .25;
  const game = await mountGame({ random: () => sample });
  assert.equal(game.element("Emblem").classList.contains("is-mirrored"), true);
  sample = .75;
  await game.listen();
  assert.equal(game.element("Emblem").classList.contains("is-mirrored"), true);
  game.click(game.element("Skip")); await game.continue();
  assert.equal(game.element("Emblem").classList.contains("is-mirrored"), false);
  game.noCredit();
  game.controller.destroy();
});

test("mode changes and destroy invalidate pending Continue without counting an unfinished session", async () => {
  const game = await mountGame();
  await game.listen();
  game.click(game.choice(game.current().id));
  const previousContinue = game.element("Continue");
  game.click(game.element("Sentences"));
  assert.equal(game.clock.pending().length, 0);
  previousContinue.click();
  await game.advance(10000);
  assert.equal(game.element("Progress").textContent, interfaceContent.t("soundquasar.progress.sentences", { number: 1, count: SOUND_QUASAR_ROUND_COUNT }));
  assert.equal(game.element("Result").hidden, true);
  assert.ok(game.choices().every((button) => button.disabled));
  await game.listen();
  game.click(game.choice(game.current().id));
  const progress = game.element("Progress").textContent;
  game.controller.destroy();
  assert.equal(game.clock.pending().length, 0);
  previousContinue.click();
  await game.advance(10000);
  assert.equal(game.element("Progress").textContent, progress);
  assert.equal(game.records.filter(([, delta]) => delta.rounds).length, 0);
  assert.equal(game.records.reduce((sum, [, delta]) => sum + (delta.xp || 0), 0), 2);
  game.noCampaign();
});

 test("muted taps play once without unmuting and require completed audio before answering", async () => {
  const game = await mountGame({ muted: true });
  assert.equal(game.speechCalls.length, 0);
  assert.equal(game.element("Listen").disabled, false);
  await game.listen();
  assert.equal(game.speechCalls[0].options.allowWhileMuted, true);
  assert.equal(game.preferences.muted, true);
  assert.ok(game.choices().every((button) => !button.disabled));
  game.click(game.choice(game.current().id));
  await game.continue();
  assert.equal(game.speechCalls.length, 1);
  assert.ok(game.choices().every((button) => button.disabled));
  game.controller.destroy();
});

test("unmuted prompts autoplay once, hide skip, and autoplay the next prompt", async () => {
  const game = await mountGame({ muted: false });
  assert.equal(game.speechCalls.length, 1);
  assert.equal(game.speechCalls[0].options.allowWhileMuted, false);
  assert.equal(game.element("Skip").hidden, true);
  const progress = game.element("Progress").textContent;
  game.element("Skip").dispatchEvent({ type: "click" });
  assert.equal(game.element("Progress").textContent, progress);
  game.shell.dispatchEvent({ type: "caatuu:speech-voices-refresh" });
  await settle();
  assert.equal(game.speechCalls.length, 1);
  game.click(game.choice(game.current().id));
  await game.continue();
  assert.equal(game.speechCalls.length, 2);
  game.controller.destroy();
});

test("failed automatic audio exposes skip and a successful retry removes it", async () => {
  const game = await mountGame({ muted: false, speechResult: { outcome: "failed" } });
  assert.equal(game.element("Skip").hidden, false);
  assert.ok(game.choices().every((button) => button.disabled));
  game.setSpeechResult({ outcome: "completed" });
  await game.listen();
  assert.equal(game.element("Skip").hidden, true);
  assert.ok(game.choices().every((button) => !button.disabled));
  game.controller.destroy();
});

test("a course with no voice can review a skipped correction then Continue without earning credit", async () => {
  const game = await mountGame({ muted: false, voiceState: { available: false, voices: [] } });
  assert.equal(game.element("Listen").disabled, true);
  assert.equal(game.element("Skip").hidden, false);
  game.click(game.element("Skip"));
  assert.equal(game.element("Result").hidden, false);
  assert.ok(game.element("ResultTarget").textContent);
  await game.continue();
  assert.equal(game.element("Progress").textContent, "Word 2 of 3");
  assert.equal(game.element("Result").hidden, true);
  game.noCredit();
  game.controller.destroy();
});

for (const outcome of ["correct", "revealed", "skipped"]) {
  test(`${outcome} sentence review offers individual dictionary words without changing assessment credit`, async () => {
    const requests = [];
    const game = await mountGame({ language: "czech", resolveWord: async (word, context) => {
      requests.push({ word, context });
      return { meaning: `Meaning of ${word}`, languageTag: "en" };
    } });
    game.click(game.element("Sentences"));
    assert.equal(requests.length, 0, "opening a question must not load word meanings");
    let item;
    if (outcome === "skipped") {
      game.click(game.element("Skip"));
      item = game.catalog.sentences.find(row => row.target === game.element("ResultTarget").textContent);
    } else {
      await game.listen();
      item = game.current();
      if (outcome === "correct") game.click(game.choice(item.id));
      else {
        const wrong = game.choices().filter(button => button.dataset.choiceId !== item.id);
        game.click(wrong[0]);
        game.click(wrong[1]);
      }
    }
    assert.ok(item, "the correction must retain the actual listening item");
    assert.equal(requests.length, 0, "showing a correction alone must not perform a lookup");
    const tokens = game.element("ResultTarget").querySelectorAll("button.quasar-result-word");
    const expected = [...new Intl.Segmenter(game.course.targetLanguage.locale, { granularity: "word" }).segment(item.target)]
      .filter(part => part.isWordLike).map(part => part.segment);
    assert.ok(expected.length > 1, "the authored sentence exercises individual-word selection");
    assert.deepEqual(tokens.map(button => button.dataset.word), expected);
    assert.equal(game.element("ResultTarget").textContent, item.target, "word controls preserve punctuation and authored spacing");
    for (const button of tokens) {
      assert.equal(button.tagName, "BUTTON");
      assert.equal(button.type, "button", "native button semantics provide keyboard activation");
      assert.equal(button.disabled, false);
    }
    const credit = JSON.stringify(game.records);
    tokens[1].focus();
    tokens[1].dispatchEvent({ type: "click", detail: 0, bubbles: true });
    await settle();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].word, expected[1]);
    assert.equal(requests[0].context.tokenIndex, 1);
    assert.equal(requests[0].context.item.targetText, item.target);
    assert.equal(game.element("Dictionary").hidden, false);
    assert.equal(game.element("Dictionary").querySelector(".dictionary-word-card__meaning").textContent, `Meaning of ${expected[1]}`);
    assert.equal(JSON.stringify(game.records), credit, "review help cannot add or rewrite listening rewards");
    const progress = game.element("Progress").textContent;
    await game.advance(86400000);
    assert.equal(game.element("Progress").textContent, progress, "dictionary review still waits for explicit Continue");
    game.controller.destroy();
  });
}

test("dictionary card clicks do not replay the whole sentence, and its speaker uses only the selected word", async () => {
  const game = await mountGame({ language: "czech", resolveWord: async () => ({ meaning: "selected meaning" }) });
  game.click(game.element("Sentences"));
  await game.listen();
  const item = game.current();
  game.click(game.choice(item.id));
  const token = game.element("ResultTarget").querySelectorAll("button.quasar-result-word")[1];
  game.click(token);
  await settle();
  const dictionary = game.element("Dictionary");
  const previousSpeech = game.speechCalls.length;
  dictionary.querySelector(".dictionary-word-card__meaning").click();
  dictionary.querySelector(".dictionary-word-card").click();
  await settle();
  assert.equal(game.speechCalls.length, previousSpeech, "the word card is excluded from free-space sentence replay");
  game.click(dictionary.querySelector(".dictionary-word-card__pronounce"));
  await settle();
  assert.equal(game.speechCalls.length, previousSpeech + 1);
  assert.equal(game.speechCalls.at(-1).text, token.dataset.word);
  assert.notEqual(game.speechCalls.at(-1).text, item.target);
  game.click(dictionary.querySelector(".moon-dictionary-close"));
  assert.equal(dictionary.hidden, true);
  assert.equal(game.document.activeElement, token, "closing the card restores keyboard focus to the selected word");
  assert.equal(game.records.length, 1);
  game.controller.destroy();
});

for (const action of ["Continue", "inactive panel", "hidden document", "controls", "report", "pagehide", "destroy"]) {
  test(`${action} aborts a pending review lookup and prevents its late meaning from appearing`, async () => {
    const pending = deferred(), requests = [];
    const game = await mountGame({ language: "czech", resolveWord: (word, context) => {
      requests.push({ word, context });
      return pending.promise;
    } });
    await game.listen();
    game.click(game.choice(game.current().id));
    const token = game.element("ResultTarget").querySelector("button.quasar-result-word");
    game.click(token);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].context.signal.aborted, false);
    const credit = JSON.stringify(game.records);
    if (action === "Continue") await game.continue();
    else if (action === "inactive panel") game.window.dispatchEvent({ type: "message", origin: game.window.location.origin, source: game.shell,
      data: { source: "caatuu-app-shell", type: "visibility", active: false } });
    else if (action === "hidden document") {
      game.parent.document.visibilityState = "hidden";
      game.parent.document.dispatchEvent({ type: "visibilitychange" });
    } else if (action === "controls") game.click(game.element("Controls").querySelector('[aria-label="Audio settings"]'));
    else if (action === "report") game.click(game.element("Report"));
    else if (action === "pagehide") game.window.dispatchEvent({ type: "pagehide", persisted: true });
    else game.controller.destroy();
    assert.equal(requests[0].context.signal.aborted, true);
    pending.resolve({ meaning: "obsolete meaning" });
    await settle();
    assert.equal(game.element("Dictionary").hidden, true);
    assert.ok(!game.element("Dictionary").textContent.includes("obsolete meaning"));
    token.click();
    await settle();
    assert.equal(requests.length, 1, "an obsolete or paused word button cannot restart a lookup");
    assert.equal(JSON.stringify(game.records), credit);
    game.controller.destroy();
  });
}

test("a replacement word selection wins when an older review lookup ignores cancellation", async () => {
  const first = deferred(), second = deferred(), requests = [];
  const game = await mountGame({ language: "czech", resolveWord: (word, context) => {
    requests.push({ word, context });
    return requests.length === 1 ? first.promise : second.promise;
  } });
  game.click(game.element("Sentences"));
  await game.listen();
  game.click(game.choice(game.current().id));
  const tokens = game.element("ResultTarget").querySelectorAll("button.quasar-result-word");
  game.click(tokens[0]);
  game.click(tokens[1]);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].context.signal.aborted, true);
  second.resolve({ meaning: "current meaning" });
  await settle();
  first.resolve({ meaning: "obsolete meaning" });
  await settle();
  assert.equal(game.element("Dictionary").querySelector(".dictionary-word-card__word").textContent, tokens[1].dataset.word);
  assert.equal(game.element("Dictionary").querySelector(".dictionary-word-card__meaning").textContent, "current meaning");
  assert.equal(game.records.length, 1);
  game.controller.destroy();
});

test("Chinese dictionary words preserve authored Hanzi tone spans and the correction's pinyin", async () => {
  const requests = [];
  const game = await mountGame({ resolveWord: async (word, context) => {
    requests.push({ word, context });
    return { meaning: "authored word meaning" };
  } });
  game.click(game.element("Sentences"));
  await game.listen();
  const item = game.current();
  game.click(game.choice(item.id));
  const target = game.element("ResultTarget"), reading = game.element("ResultReading");
  const tokens = target.querySelectorAll("button.quasar-result-word");
  assert.ok(tokens.length > 1, "an unspaced Chinese sentence still offers individual lexical words");
  assert.equal(target.textContent, item.target);
  assert.equal(target.querySelectorAll(".caatuu-target-tone").map(node => node.textContent).join(""),
    item.reading.tokens.flatMap(token => token.units).map(unit => unit.surface).join(""));
  const pinyin = item.reading.tokens.flatMap(token => token.units.map(unit => unit.notation)).join(" ");
  assert.equal(reading.textContent, pinyin);
  game.click(tokens[0]);
  await settle();
  assert.equal(requests[0].word, tokens[0].dataset.word);
  assert.deepEqual(requests[0].context.item.targetReading, item.reading);
  assert.equal(reading.textContent, pinyin);
  assert.equal(target.textContent, item.target);
  game.controller.destroy();
});

test("Arabic dictionary selection keeps complete vowel-marked words and their reading guide", async () => {
  const requests = [];
  const game = await mountGame({ language: "arabic-standard", resolveWord: async (word, context) => {
    requests.push({ word, context });
    return { meaning: "authored Arabic word meaning" };
  } });
  game.click(game.element("Sentences"));
  await game.listen();
  const item = game.current();
  game.click(game.choice(item.id));
  const target = game.element("ResultTarget");
  const tokens = target.querySelectorAll("button.quasar-result-word");
  const expected = [...new Intl.Segmenter(game.course.targetLanguage.locale, { granularity: "word" }).segment(item.target)]
    .filter(part => part.isWordLike).map(part => part.segment);
  assert.deepEqual(tokens.map(button => button.dataset.word), expected, "Arabic shaping must not be divided into character controls");
  assert.equal(target.dir, "rtl");
  assert.ok(target.querySelector("rt"));
  game.click(tokens[0]);
  await settle();
  assert.equal(requests[0].word, expected[0]);
  assert.equal(target.dir, "rtl");
  assert.ok(target.querySelector("rt"));
  game.document.querySelector('[data-arabic-romanization-setting="sound-quasar"]').click();
  assert.equal(target.textContent, item.target);
  assert.deepEqual(target.querySelectorAll("button.quasar-result-word").map(button => button.dataset.word), expected);
  game.controller.destroy();
});
