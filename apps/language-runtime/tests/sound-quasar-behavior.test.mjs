import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { newContentEncounterId } from "../static/source/games/content-progression.mjs";

import { createBrowserHarness } from "./helpers/fake-browser.mjs";
import { createInterfaceContent } from "../static/source/interface-content.mjs";
import { appendTargetToneText } from "../static/source/target-text-tones.mjs";
import { fetchDeclaredCourseGameJson, readEmbeddedCourseProfile } from "../static/source/games/course-game-content.mjs";
import { createSpeechIcon, mountEmbeddedGameControls, mountRobotLoadingScreen } from "../static/source/games/embedded-game-controls.mjs";
import { createSoundQuasarSession, evaluateSoundQuasarChoice, validateSoundQuasarCatalog, soundQuasarItemsForDifficulty }
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
  realLearning = false, onRecord, mutateCatalog, random = () => 0, localStorageValues = {}, interfaceOverride, beforeContent } = {}) {
  const raw = JSON.parse(await readFile(new URL(`../../languages/${language}/static/data/games/sound-quasar/content.json`, import.meta.url), "utf8"));
  mutateCatalog?.(raw);
  const catalog = validateSoundQuasarCatalog(raw);
  const course = {
    id: catalog.courseId,
    routePrefix: `/${catalog.courseId}`,
    sourceLanguage: { id: catalog.learnerBaseLanguage.split("-")[0], locale: catalog.learnerBaseLanguage, direction: "ltr" },
    targetLanguage: { id: catalog.targetLanguageId, locale: catalog.audio.locale, direction: "ltr" },
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
  shell.CaatuuLearning = { ...learning, record: (...args) => {
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
    newContentEncounterId,
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
  const controller = await vm.runInContext("mountSharedSoundQuasar({ scope: window, fetchImpl: fetch, random: testRandom })", harness.context);
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
    setReportResult(value) { reportOutcome = value; },
    setVoiceState(value) { voices = value; }, setSpeechResult(value) { audioResult = value; } };
}

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
  await game.clock.advance(1200);
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

test("the listening host uses the selected course difficulty for both answers and choices", async () => {
  const game = await mountGame({ language: "english-from-spanish", realLearning: true });
  for (const difficulty of [1, 2, 3]) {
    game.shell.CaatuuLearning.setDifficulty(difficulty);
    await settle();
    const eligible = new Set(game.catalog.items.filter(row => row.difficulty <= difficulty).map(row => row.id));
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
  await game.advance();
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
    await game.advance();
    assert.equal(game.element("Result").hidden, true);
    assert.ok(game.choices().every((button) => !button.classList.contains("is-wrong")));
    assert.equal(game.records.reduce((sum, [, delta]) => sum + (delta.xp || 0), 0), 0);
    assert.equal(game.records.filter(([, delta]) => delta.rounds).length, 0);
    game.controller.destroy();
  });
}

test("an entirely missed session gives no XP, coin, or streak qualification", async () => {
  const game = await mountGame();
  for (let round = 0; round < 5; round += 1) {
    await game.listen();
    const mistakes = game.choices().filter((button) => button.dataset.choiceId !== game.current().id);
    game.click(mistakes[0]);
    game.click(mistakes[1]);
    await game.advance();
  }
  assert.equal(game.element("Transition").hidden, false);
  assert.equal(game.records.length, 10);
  assert.ok(game.records.every(([, delta]) => delta.xp === 0 && !delta.rounds && !delta.streakEligible));
  game.controller.destroy();
});

test("five words earn answer XP and one completed round, then robots lead to the next batch without extra rewards", async () => {
  const game = await mountGame();
  const answered = new Set();
  for (let index = 0; index < 5; index += 1) {
    await game.listen();
    const item = game.current();
    assert.equal(answered.has(item.id), false, "a session does not repeat an answer");
    answered.add(item.id);
    if (index === 0) {
      game.click(game.choices().find((button) => button.dataset.choiceId !== item.id));
      game.click(game.choice(item.id));
    } else if (index === 1) {
      game.click(game.element("Skip"));
      continue;
    } else game.click(game.choice(item.id));
    await game.advance();
  }
  assert.equal(game.element("Transition").hidden, false);
  assert.equal(game.element("Summary"), null);
  assert.equal(game.records.filter(([, delta]) => delta.attempts).length, 5);
  assert.equal(game.records.reduce((sum, [, delta]) => sum + (delta.xp || 0), 0), 4);
  assert.deepEqual(game.records.filter(([, delta]) => delta.rounds), [["sound-quasar", { rounds: 1, streakEligible: true }]]);
  const recordsBeforeRestart = structuredClone(game.records);
  game.clock.latest().callback();
  await game.advance(10000);
  assert.deepEqual(game.records, recordsBeforeRestart, "a duplicate Finish event cannot count the round twice");
  game.noCampaign();
  assert.equal(game.element("Restart"), null);
  assert.equal(game.element("Transition").hidden, true);
  assert.ok(game.choices().every((button) => button.disabled));
  assert.equal(game.speechCalls.length, 5);
  assert.deepEqual(game.records, recordsBeforeRestart, "restarting does not reward an unplayed session");
  game.noCampaign();
  game.controller.destroy();
});

test("robot transitions retain sentence mode and six options, then resume automatically", async () => {
  const game = await mountGame();
  game.click(game.element("Sentences"));
  game.click(game.element("SixChoices"));
  for (let index = 0; index < 5; index += 1) game.click(game.element("Skip"));
  assert.equal(game.element("Transition").hidden, false);
  assert.match(game.element("Robot").src, /^\/assets\/robots\//u);
  assert.equal(game.element("Transition").classList.contains("caatuu-game-robot-loading"), true);
  assert.equal(game.element("Robot").classList.contains("caatuu-game-robot-loading-art"), true);
  assert.equal(game.element("Robot").src, game.element("Loading").querySelector("img").src);
  assert.equal(game.fetchCalls.length, 1, "the shared robot does not request a private asset catalog");
  await game.advance(1199);
  assert.equal(game.element("Transition").hidden, false);
  await game.advance(1);
  assert.equal(game.element("Transition").hidden, true);
  assert.equal(game.element("Game").dataset.mode, "sentences");
  assert.equal(game.choices().length, 6);
  assert.equal(game.element("Progress").textContent, "Sentence 1 of 5");
  assert.ok(game.choices().every((button) => button.disabled));
  game.noCredit();
  game.controller.destroy();
});

for (const reason of ["hidden", "inactive", "destroyed"]) {
  test(`a ${reason} game invalidates the robot transition timer`, async () => {
    const game = await mountGame();
    const visibility = (active) => game.window.dispatchEvent({ type: "message", origin: "https://caatuu.test", source: game.shell,
      data: { source: "caatuu-app-shell", type: "visibility", active } });
    for (let index = 0; index < 5; index += 1) game.click(game.element("Skip"));
    const timer = game.clock.latest();
    if (reason === "hidden") {
      game.shell.document.visibilityState = "hidden";
      game.shell.document.dispatchEvent({ type: "visibilitychange" });
    } else if (reason === "inactive") visibility(false);
    else game.controller.destroy();
    timer.callback();
    await game.advance(5000);
    assert.equal(game.element("Transition").hidden, reason === "destroyed");
    assert.equal(game.speechCalls.length, 0);
    if (reason !== "destroyed") {
      assert.equal(game.element("Transition").dataset.active, "false");
      if (reason === "hidden") {
        game.shell.document.visibilityState = "visible";
        game.shell.document.dispatchEvent({ type: "visibilitychange" });
      } else { visibility(true); await settle(); }
      assert.equal(game.element("Transition").dataset.active, "true");
      await game.advance(1200);
      assert.equal(game.element("Transition").hidden, true);
    }
    game.noCredit();
    game.controller.destroy();
  });
}

test("a campaign batch hands off once and accepts advance only from its own shell", async () => {
  const game = await mountGame();
  game.shell.document.body.dataset.campaignActive = "true";
  for (let index = 0; index < 5; index += 1) game.click(game.element("Skip"));
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
  await game.advance();
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
  game.click(game.element("Skip"));
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
  game.click(game.element("Skip"));
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
    if (args[1].rounds) clock.latest().callback();
  } });
  for (let index = 0; index < 5; index += 1) {
    await game.listen();
    if (index === 0) {
      attemptedChoice = game.choices().find((button) => button.dataset.choiceId !== game.current().id);
      game.click(attemptedChoice);
    }
    attemptedChoice = game.choice(game.current().id);
    game.click(attemptedChoice);
    await game.advance();
  }
  assert.equal(game.records.length, 7, "one wrong attempt, five successful attempts, and one finished session");
  assert.equal(game.records.reduce((sum, [, delta]) => sum + (delta.xp || 0), 0), 5);
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
    for (let index = 0; index < 5; index += 1) {
      assert.equal(game.element("Progress").textContent, interfaceContent.t("soundquasar.progress.sentences", { number: index + 1, count: 5 }));
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
      await game.advance();
    }
    assert.ok(artwork.size > 1, "successive questions choose different music artwork");
    assert.equal(game.element("Transition").hidden, false);
    assert.equal(game.records.reduce((sum, [, delta]) => sum + (delta.xp || 0), 0), 5);
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
  assert.equal(game.element("Progress").textContent, interfaceContent.t("soundquasar.progress", { number: 1, count: 5 }));
  assert.ok(game.choices().every((button) => button.disabled));
  assert.equal(game.records.filter(([, delta]) => delta.rounds).length, 0, "changing an unfinished session does not count a round");
  game.noCampaign();
  game.controller.destroy();
});

test("skipping an entire session gives no XP, coin, or streak qualification", async () => {
  const game = await mountGame({ realLearning: true });
  for (let index = 0; index < 5; index += 1) game.click(game.element("Skip"));
  assert.equal(game.element("Transition").hidden, false);
  game.noCredit();
  assert.equal(game.shell.CaatuuLearning.snapshot().summary.xp, 0);
  assert.equal(game.shell.CaatuuLearning.snapshot().summary.rounds, 0);
  assert.equal(game.shell.CaatuuLearning.snapshot().streak.currentDays, 0);
  game.controller.destroy();
});

test("earned Quasar XP and rounds persist through the shared learning profile and journey totals", async () => {
  const game = await mountGame({ realLearning: true });
  for (let index = 0; index < 5; index += 1) {
    await game.listen();
    game.click(game.choice(game.current().id));
    await game.advance();
  }
  const profile = game.shell.CaatuuLearning.snapshot();
  assert.equal(profile.performance.games["sound-quasar"].xp, 5);
  assert.equal(profile.summary.rounds, 1);
  assert.equal(profile.journey.summary.xp, 5);
  assert.equal(profile.journey.summary.rounds, 1);
  assert.equal(profile.streak.currentDays, 1);
  // Reload all durable storage: progress may be in a compact checkpoint or
  // pending journal entries when the simulated browser has no lock provider.
  const stored = game.parent.localStorage.snapshot();
  const reloaded = createBrowserHarness({ course: game.course, localStorageValues: stored });
  vm.runInContext(learningProfileSource, reloaded.context, { filename: "learning-profile.js" });
  assert.equal(reloaded.window.CaatuuLearning.snapshot().journey.summary.xp, 5);
  assert.equal(reloaded.window.CaatuuLearning.snapshot().journey.summary.rounds, 1);
  game.noCampaign();
  game.controller.destroy();
});

test("skip moves directly to another prompt without showing the answer", async () => {
  const game = await mountGame();
  assert.equal(game.element("Reveal"), null);
  assert.equal(game.element("Next"), null);
  const choices = game.choices();
  game.click(game.element("Skip"));
  assert.equal(game.element("Progress").textContent, "Word 2 of 5");
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
  test(`${mode} corrections keep ${meaning.length} translation characters visible for ${delay}ms`, async () => {
    const game = await mountGame({ mutateCatalog: (catalog) => {
      for (const item of [...catalog.items, ...catalog.sentences]) item.meaning = meaning;
    } });
    if (mode === "sentences") game.click(game.element("Sentences"));
    await game.listen();
    const wrongChoices = game.choices().filter(button => button.dataset.choiceId !== game.current().id);
    game.click(wrongChoices[0]);
    game.click(wrongChoices[1]);
    assert.equal(game.clock.pending().length, 1);
    assert.equal(game.clock.latest().delay, delay);
    const firstProgress = game.element("Progress").textContent;
    await game.advance(delay - 1);
    assert.equal(game.element("Progress").textContent, firstProgress);
    assert.equal(game.element("Result").hidden, false);
    await game.advance(1);
    assert.notEqual(game.element("Progress").textContent, firstProgress);
    assert.equal(game.element("Result").hidden, true);
    game.controller.destroy();
  });
}

for (const pauseReason of ["report", "controls", "hidden document", "inactive panel", "persisted pagehide"]) {
  test(`${pauseReason} pauses the result and resumes a full reading interval`, async () => {
    const game = await mountGame();
    await game.listen();
    game.click(game.choice(game.current().id));
    const timer = game.clock.latest();
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
    timer.callback();
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
    assert.equal(game.clock.pending().length, 1);
    assert.equal(game.clock.latest().delay, timer.delay);
    await game.advance(timer.delay - 1);
    assert.equal(game.element("Progress").textContent, progress);
    await game.advance(1);
    assert.notEqual(game.element("Progress").textContent, progress);
    assert.equal(game.records.length, 1, "pausing does not duplicate the successful answer's XP");
    game.controller.destroy();
  });
}

test("replaying a result pauses its transition until audio completes and then restarts the interval", async () => {
  const game = await mountGame();
  await game.listen();
  game.click(game.choice(game.current().id));
  const oldTimer = game.clock.latest();
  const progress = game.element("Progress").textContent;
  await game.advance(1000);
  const playback = deferred();
  game.setSpeechResult(playback.promise);
  await game.listen();
  assert.equal(game.clock.pending().length, 0);
  oldTimer.callback();
  await game.advance(10000);
  assert.equal(game.element("Progress").textContent, progress);
  playback.resolve({ outcome: "completed" });
  await settle();
  assert.equal(game.clock.latest().delay, oldTimer.delay);
  assert.equal(game.clock.pending().length, 1);
  await game.advance(oldTimer.delay - 1);
  assert.equal(game.element("Progress").textContent, progress);
  await game.advance(1);
  assert.notEqual(game.element("Progress").textContent, progress);
  assert.equal(game.records.length, 1);
  game.controller.destroy();
});

for (const language of ["czech", "mandarin-simplified", "spanish"]) {
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

test("six-answer preference survives remounting and safely falls back for smaller catalogs", async () => {
  const key = "caatuu-zh.soundQuasar.choiceCount.v1";
  const game = await mountGame({ localStorageValues: { [key]: "6" } });
  assert.equal(game.choices().length, 6);
  game.controller.destroy();
  const small = await mountGame({ localStorageValues: { [key]: "6" }, mutateCatalog(catalog) {
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

test("changing answer count cancels result advancement without granting a completed round", async () => {
  const game = await mountGame();
  await game.listen();
  game.click(game.choice(game.current().id));
  const oldTimer = game.clock.latest();
  game.click(game.element("SixChoices"));
  oldTimer.callback();
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
  game.click(game.element("Skip"));
  assert.equal(game.element("Emblem").classList.contains("is-mirrored"), false);
  game.noCredit();
  game.controller.destroy();
});

test("mode changes and destroy invalidate result callbacks without counting an unfinished session", async () => {
  const game = await mountGame();
  await game.listen();
  game.click(game.choice(game.current().id));
  const wordTimer = game.clock.latest();
  game.click(game.element("Sentences"));
  assert.equal(game.clock.pending().length, 0);
  wordTimer.callback();
  await game.advance(10000);
  assert.equal(game.element("Progress").textContent, interfaceContent.t("soundquasar.progress.sentences", { number: 1, count: 5 }));
  assert.equal(game.element("Result").hidden, true);
  assert.ok(game.choices().every((button) => button.disabled));
  await game.listen();
  game.click(game.choice(game.current().id));
  const sentenceTimer = game.clock.latest();
  const progress = game.element("Progress").textContent;
  game.controller.destroy();
  assert.equal(game.clock.pending().length, 0);
  sentenceTimer.callback();
  wordTimer.callback();
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
  await game.advance();
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
  await game.advance();
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

test("a course with no voice can skip without exposing targets or earning credit", async () => {
  const game = await mountGame({ muted: false, voiceState: { available: false, voices: [] } });
  assert.equal(game.element("Listen").disabled, true);
  assert.equal(game.element("Skip").hidden, false);
  game.click(game.element("Skip"));
  assert.equal(game.element("Progress").textContent, "Word 2 of 5");
  assert.equal(game.element("Result").hidden, true);
  game.noCredit();
  game.controller.destroy();
});
